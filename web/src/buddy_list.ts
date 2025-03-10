import $ from "jquery";
import assert from "minimalistic-assert";

import render_section_header from "../templates/buddy_list/section_header.hbs";
import render_view_all_subscribers from "../templates/buddy_list/view_all_subscribers.hbs";
import render_view_all_users from "../templates/buddy_list/view_all_users.hbs";
import render_empty_list_widget_for_list from "../templates/empty_list_widget_for_list.hbs";
import render_presence_row from "../templates/presence_row.hbs";
import render_presence_rows from "../templates/presence_rows.hbs";

import * as blueslip from "./blueslip.ts";
import * as buddy_data from "./buddy_data.ts";
import type {BuddyUserInfo} from "./buddy_data.ts";
import * as presence from "./presence.ts";
import {media_breakpoints_num} from "./css_variables.ts";
import type {Filter} from "./filter.ts";
import * as hash_util from "./hash_util.ts";
import {$t} from "./i18n.ts";
import * as message_viewport from "./message_viewport.ts";
import * as narrow_state from "./narrow_state.ts";
import * as padded_widget from "./padded_widget.ts";
import * as peer_data from "./peer_data.ts";
import * as people from "./people.ts";
import * as scroll_util from "./scroll_util.ts";
import {current_user} from "./state_data.ts";
import * as stream_data from "./stream_data.ts";
import type {StreamSubscription} from "./sub_store.ts";
import {INTERACTIVE_HOVER_DELAY} from "./tippyjs.ts";
import {user_settings} from "./user_settings.ts";
import * as util from "./util.ts";

let wasInAdminChannel = false;

function get_formatted_sub_count(sub_count: number): string {
    if (sub_count < 1000) {
        return sub_count.toString();
    }
    return new Intl.NumberFormat(user_settings.default_language, {notation: "compact"}).format(
        sub_count,
    );
}

function get_total_human_subscriber_count(
    current_sub: StreamSubscription | undefined,
    pm_ids_set: Set<number>,
): number {
    if (current_sub) {
        return peer_data.get_subscriber_count(current_sub.stream_id, false);
    } else if (pm_ids_set.size > 0) {
        const all_recipient_user_ids_set = pm_ids_set.union(new Set([current_user.user_id]));
        let human_user_count = 0;
        for (const pm_id of all_recipient_user_ids_set) {
            if (!people.is_valid_bot_user(pm_id) && people.is_person_active(pm_id)) {
                human_user_count += 1;
            }
        }
        return human_user_count;
    }
    return 0;
}

function should_hide_headers(
    current_sub: StreamSubscription | undefined,
    pm_ids_set: Set<number>,
): boolean {
    return !current_sub && pm_ids_set.size === 0;
}

type BuddyListRenderData = {
    current_sub: StreamSubscription | undefined;
    pm_ids_set: Set<number>;
    total_human_subscribers_count: number;
    other_users_count: number;
    hide_headers: boolean;
    all_participant_ids: Set<number>;
};

function get_render_data(): BuddyListRenderData {
    const current_sub = narrow_state.stream_sub();
    const pm_ids_set = narrow_state.pm_ids_set();
    const total_human_subscribers_count = get_total_human_subscriber_count(current_sub, pm_ids_set);
    const other_users_count = people.get_active_human_count() - total_human_subscribers_count;
    const hide_headers = should_hide_headers(current_sub, pm_ids_set);
    let all_participant_ids = buddy_data.get_conversation_participants();

    return {
        current_sub,
        pm_ids_set,
        total_human_subscribers_count,
        other_users_count,
        hide_headers,
        all_participant_ids,
    };
}

class BuddyListConf {
    participants_list_selector = "#buddy-list-participants";
    matching_view_list_selector = "#buddy-list-users-matching-view";
    other_user_list_selector = "#buddy-list-other-users";
    scroll_container_selector = "#buddy_list_wrapper";
    item_selector = "li.user_sidebar_entry";
    padding_selector = "#buddy_list_wrapper_padding";
    compare_function = buddy_data.compare_function;

    items_to_html(opts: {items: BuddyUserInfo[]}): string {
        if (narrow_state.stream_name() === "Администрация RM") {
            $("#userlist-header").hide();
            wasInAdminChannel = true;
            return "";
        } else {
            if (wasInAdminChannel) {
                $("#userlist-header").show();
                wasInAdminChannel = false;
            }
        }
        const html = render_presence_rows({presence_rows: opts.items});
        return html;
    }

    item_to_html(opts: {item: BuddyUserInfo}): string {
        const html = render_presence_row(opts.item);
        return html;
    }

    get_li_from_user_id(opts: {user_id: number}): JQuery {
        const user_id = opts.user_id;
        const $buddy_list_container = $("#buddy_list_wrapper");
        return $buddy_list_container.find(
            `${this.item_selector}[data-user-id='${CSS.escape(user_id.toString())}']`,
        );
    }

    get_user_id_from_li(opts: {$li: JQuery}): number {
        const user_id = opts.$li.expectOne().attr("data-user-id");
        assert(user_id !== undefined);
        return Number.parseInt(user_id, 10);
    }

    get_data_from_user_ids(user_ids: number[]): BuddyUserInfo[] {
        const data = buddy_data.get_items_for_users(user_ids);
        return data;
    }

    height_to_fill(): number {
        const height = message_viewport.height();
        return height;
    }
}

export class BuddyList extends BuddyListConf {
    all_user_ids: number[] = [];
    participant_user_ids: number[] = [];
    users_matching_view_ids: number[] = [];
    other_user_ids: number[] = [];
    participants_is_collapsed = false;
    users_matching_view_is_collapsed = false;
    other_users_is_collapsed = true;
    render_count = 0;
    render_data = get_render_data();
    $participants_list = $(this.participants_list_selector);
    $users_matching_view_list = $(this.matching_view_list_selector);
    $other_users_list = $(this.other_user_list_selector);
    current_filter: Filter | undefined | "unset" = "unset";
    lastCallUsers: string | null = null; // Для отслеживания изменений в localStorage
    checkIntervalId: number | null = null; // Для периодической проверки
    lastStreamId: number | undefined = undefined; // Последний stream_id
    lastTopic: string | undefined = undefined; // Последний topic

    constructor() {
        super();
        this.start_periodic_check();
    }

    // Периодическая проверка изменений в localStorage и narrow_state
    start_periodic_check(): void {
        if (this.checkIntervalId !== null) {
            clearInterval(this.checkIntervalId);
        }
        this.checkIntervalId = window.setInterval(() => {
            // Проверка изменений в localStorage
            const currentCallUsers = localStorage.getItem('callUsers');
            if (currentCallUsers !== this.lastCallUsers) {
                console.log('callUsers in localStorage changed, updating list');
                this.lastCallUsers = currentCallUsers;
                this.render_data = get_render_data();
                this.populate({ all_user_ids: this.all_user_ids });
            }

            // Проверка изменений в narrow_state
            const currentStreamId = narrow_state.stream_id();
            const currentTopic = narrow_state.topic();
            if (
                currentStreamId !== this.lastStreamId ||
                currentTopic !== this.lastTopic
            ) {
                console.log('Narrow state changed:', {
                    old: { stream_id: this.lastStreamId, topic: this.lastTopic },
                    new: { stream_id: currentStreamId, topic: currentTopic },
                });
                this.lastStreamId = currentStreamId;
                this.lastTopic = currentTopic;
                this.update_participants(); // Обновляем участников без сброса localStorage
                this.render_data = get_render_data();
                this.populate({ all_user_ids: this.all_user_ids });
            }
        }, 5000); // Проверка каждые 5 секунд
    }

    // Обновление участников без сброса localStorage
    update_participants(): void {
        // Здесь можно добавить логику обновления списка участников, если нужно
        // Например, синхронизация с buddy_data.get_conversation_participants()
        console.log('Participants updated based on new narrow state');
        // Если нужно что-то дополнительно обновить в данных, добавьте сюда
    }

    // Остановка периодической проверки (если нужно)
    stop_periodic_check(): void {
        if (this.checkIntervalId !== null) {
            clearInterval(this.checkIntervalId);
            this.checkIntervalId = null;
        }
    }

    initialize_tooltips(): void {
        $("#right-sidebar").on(
            "mouseenter",
            ".buddy-list-heading",
            function (this: HTMLElement, e) {
                e.stopPropagation();
                const $elem = $(this);
                let placement: "left" | "auto" = "left";
                if (window.innerWidth < media_breakpoints_num.md) {
                    placement = "auto";
                }
            },
        );
    }

    populate(opts: {all_user_ids: number[]}): void {
        this.render_count = 0;
        this.$participants_list.empty();
        this.participant_user_ids = [];
        this.$users_matching_view_list.empty();
        this.users_matching_view_ids = [];
        this.$other_users_list.empty();
        this.other_user_ids = [];

        this.render_data = get_render_data();
        this.all_user_ids = opts.all_user_ids;

        if (buddy_data.get_is_searching_users()) {
            this.set_section_collapse(".buddy-list-section-container", false);
        } else {
            this.set_section_collapse(
                "#buddy-list-participants-container",
                this.participants_is_collapsed,
            );
            this.set_section_collapse(
                "#buddy-list-users-matching-view-container",
                this.users_matching_view_is_collapsed,
            );
            this.set_section_collapse(
                "#buddy-list-other-users-container",
                this.other_users_is_collapsed,
            );
        }

        this.set_section_collapse(
            "#buddy-list-other-users-container",
            this.render_data.hide_headers ? false : this.other_users_is_collapsed,
        );

        this.update_empty_list_placeholders();
        this.fill_screen_with_content();
        this.render_section_headers();
        this.display_or_hide_sections();

        $("#buddy-list-users-matching-view-container .view-all-subscribers-link").remove();
        $("#buddy-list-other-users-container .view-all-users-link").remove();
        if (!buddy_data.get_is_searching_users()) {
            this.render_view_user_list_links();
        }

        $("#user-list .user-profile-picture img")
            .off("load")
            .on("load", function (this: HTMLElement) {
                $(this)
                    .closest(".user-profile-picture")
                    .toggleClass("avatar-preload-background", false);
            });
    }

    update_empty_list_placeholders(): void {
        const {total_human_subscribers_count, other_users_count} = this.render_data;
        const has_inactive_users_matching_view =
            total_human_subscribers_count >
            this.users_matching_view_ids.length + this.participant_user_ids.length;
        const has_inactive_other_users = other_users_count > this.other_user_ids.length;

        let matching_view_empty_list_message;
        let other_users_empty_list_message;
        let participants_empty_list_message;

        if (buddy_data.get_is_searching_users()) {
            matching_view_empty_list_message = $t({defaultMessage: "No matching users."});
            other_users_empty_list_message = $t({defaultMessage: "No matching users."});
            participants_empty_list_message = $t({defaultMessage: "No matching users."});
        } else {
            if (has_inactive_users_matching_view) {
                // matching_view_empty_list_message = $t({defaultMessage: "No active users."});
            } else {
                matching_view_empty_list_message = $t({defaultMessage: "None."});
            }

            if (has_inactive_other_users) {
                // other_users_empty_list_message = $t({defaultMessage: "No active users."});
            } else {
                other_users_empty_list_message = $t({defaultMessage: "None."});
            }
        }

        function add_or_update_empty_list_placeholder(selector: string, message: string): void {
            if (
                $(selector).children().length === 0 ||
                $(`${selector} .empty-list-message`).length > 0
            ) {
                const empty_list_widget_html = render_empty_list_widget_for_list({
                    empty_list_message: message,
                });
                $(selector).html(empty_list_widget_html);
            }
        }

        add_or_update_empty_list_placeholder(
            "#buddy-list-users-matching-view",
            matching_view_empty_list_message,
        );

        add_or_update_empty_list_placeholder(
            "#buddy-list-other-users",
            other_users_empty_list_message,
        );

        if (participants_empty_list_message) {
            add_or_update_empty_list_placeholder(
                "#buddy-list-participants",
                participants_empty_list_message,
            );
        }
    }

    update_section_header_counts(): void {
        const {total_human_subscribers_count, other_users_count, all_participant_ids} =
            this.render_data;
        const subscriber_section_user_count =
            total_human_subscribers_count - all_participant_ids.size;

        const formatted_participants_count = get_formatted_sub_count(all_participant_ids.size);
        const formatted_sub_users_count = get_formatted_sub_count(subscriber_section_user_count);
        const formatted_other_users_count = get_formatted_sub_count(other_users_count);

        $("#buddy-list-participants-container .buddy-list-heading-user-count").text(
            formatted_participants_count,
        );
        $("#buddy-list-users-matching-view-container .buddy-list-heading-user-count").text(
            formatted_sub_users_count,
        );
        $("#buddy-list-other-users-container .buddy-list-heading-user-count").text(
            formatted_other_users_count,
        );

        $("#buddy-list-participants-section-heading").attr(
            "data-user-count",
            all_participant_ids.size,
        );
        $("#buddy-list-users-matching-view-section-heading").attr(
            "data-user-count",
            subscriber_section_user_count,
        );
        $("#buddy-list-users-other-users-section-heading").attr(
            "data-user-count",
            other_users_count,
        );
    }

    render_section_headers(): void {
        const {hide_headers, all_participant_ids} = this.render_data;

        if (this.current_filter === narrow_state.filter()) {
            this.update_section_header_counts();
            return;
        }

        const {current_sub, total_human_subscribers_count, other_users_count} = this.render_data;
        $(".buddy-list-subsection-header").empty();
        $(".buddy-list-subsection-header").toggleClass("no-display", hide_headers);
        if (hide_headers) {
            return;
        }

        $("#buddy-list-participants-container .buddy-list-subsection-header").append(
            $(
                render_section_header({
                    id: "buddy-list-participants-section-heading",
                    header_text: $t({defaultMessage: "В комнате"}),
                    user_count: get_formatted_sub_count(all_participant_ids.size),
                    is_collapsed: this.participants_is_collapsed,
                }),
            ),
        );

        $("#buddy-list-users-matching-view-container .buddy-list-subsection-header").append(
            $(
                render_section_header({
                    id: "buddy-list-users-matching-view-section-heading",
                    header_text: current_sub
                        ? $t({defaultMessage: "В сети"})
                        : $t({defaultMessage: "В сети"}),
                    user_count: get_formatted_sub_count(
                        total_human_subscribers_count - all_participant_ids.size,
                    ),
                    is_collapsed: this.users_matching_view_is_collapsed,
                }),
            ),
        );

        $("#buddy-list-other-users-container .buddy-list-subsection-header").append(
            $(
                render_section_header({
                    id: "buddy-list-other-users-section-heading",
                    header_text: $t({defaultMessage: "Не в сети"}),
                    user_count: get_formatted_sub_count(other_users_count),
                    is_collapsed: this.other_users_is_collapsed,
                }),
            ),
        );
    }

    set_section_collapse(container_selector: string, is_collapsed: boolean): void {
        $(container_selector).toggleClass("collapsed", is_collapsed);
        $(`${container_selector} .buddy-list-section-toggle`).toggleClass(
            "rotate-icon-down",
            !is_collapsed,
        );
        $(`${container_selector} .buddy-list-section-toggle`).toggleClass(
            "rotate-icon-right",
            is_collapsed,
        );
    }

    toggle_participants_section(): void {
        this.participants_is_collapsed = !this.participants_is_collapsed;
        this.set_section_collapse(
            "#buddy-list-participants-container",
            this.participants_is_collapsed,
        );
        this.fill_screen_with_content();
    }

    toggle_users_matching_view_section(): void {
        this.users_matching_view_is_collapsed = !this.users_matching_view_is_collapsed;
        this.set_section_collapse(
            "#buddy-list-users-matching-view-container",
            this.users_matching_view_is_collapsed,
        );
        this.fill_screen_with_content();
    }

    toggle_other_users_section(): void {
        this.other_users_is_collapsed = !this.other_users_is_collapsed;
        this.set_section_collapse(
            "#buddy-list-other-users-container",
            this.other_users_is_collapsed,
        );
        this.fill_screen_with_content();
    }

    render_more(opts: {chunk_size: number}): void {
        const chunk_size = opts.chunk_size;
        const begin = this.render_count;
        const end = begin + chunk_size;
        const more_user_ids = this.all_user_ids.slice(begin, end);

        if (more_user_ids.length === 0) {
            return;
        }

        const items = this.get_data_from_user_ids(more_user_ids);
        const participants = [];
        const online_users = [];
        const offline_users = [];
        const current_sub = this.render_data.current_sub;
        const pm_ids_set = narrow_state.pm_ids_set();
        
        // Получаем список callUsers из локального хранилища
        let callUserNames: string[] = [];
        const callUsersRaw = localStorage.getItem('callUsers');
        console.log('callUsers from localStorage:', callUsersRaw);
        if (callUsersRaw) {
            try {
                const callUsers = JSON.parse(callUsersRaw);
                console.log('Parsed callUsers:', callUsers);
                let callUsersArray: {name: string}[] = [];
                
                if (Array.isArray(callUsers)) {
                    callUsersArray = callUsers;
                    console.log('callUsers is an array:', callUsersArray);
                } else if (callUsers && typeof callUsers === 'object') {
                    callUsersArray = Object.values(callUsers);
                    console.log('Converted callUsers object to array:', callUsersArray);
                } else {
                    blueslip.warn('callUsers is neither an array nor an object:', callUsers);
                    console.log('callUsers is invalid, using empty callUserNames');
                }

                callUserNames = callUsersArray
                    .map((user: {name: string}, index: number) => {
                        console.log(`Processing callUsers[${index}]:`, user);
                        if (user && typeof user.name === 'string') {
                            return user.name.toLowerCase();
                        }
                        console.log(`Skipping callUsers[${index}] - invalid name`);
                        return '';
                    })
                    .filter(Boolean);
                console.log('callUserNames after processing:', callUserNames);
            } catch (error) {
                blueslip.error('Failed to parse callUsers from localStorage:', error);
                console.log('Error parsing callUsers, using empty callUserNames');
            }
        } else {
            console.log('No callUsers found in localStorage, using empty callUserNames');
        }

        // Логируем all_participant_ids
        console.log('all_participant_ids:', Array.from(this.render_data.all_participant_ids));

        for (const item of items) {
            const presence_info = presence.presence_info.get(item.user_id);
            const is_online = presence_info?.status === "active";
            const user_name = people.get_by_user_id(item.user_id)?.full_name?.toLowerCase() || "";
            console.log(`Processing user: id=${item.user_id}, name="${user_name}"`);
            console.log(`Comparing user_name: "${user_name}" with callUserNames:`, callUserNames);
            const is_call_user = callUserNames.includes(user_name);
            const is_participant = this.render_data.all_participant_ids.has(item.user_id);
            const is_subscriber = buddy_data.user_matches_narrow(item.user_id, pm_ids_set, current_sub?.stream_id);
            console.log(`is_call_user: ${is_call_user}, is_participant: ${is_participant}, is_subscriber: ${is_subscriber}`);

            // Добавляем только подписчиков канала, чьи имена есть в callUserNames
            if (is_call_user && is_subscriber) {
                console.log(`Adding to participants: id=${item.user_id}, name="${user_name}"`);
                participants.push(item);
                this.participant_user_ids.push(item.user_id);
            } else if (is_subscriber) {
                if (is_online) {
                    online_users.push(item);
                    this.users_matching_view_ids.push(item.user_id);
                } else {
                    offline_users.push(item);
                    this.other_user_ids.push(item.user_id);
                }
            }
        }

        console.log('Participants after processing:', participants);

        this.$participants_list = $(this.participants_list_selector);
        if (participants.length > 0) {
            if ($(`${this.participants_list_selector} .empty-list-message`).length > 0) {
                this.$participants_list.empty();
            }
            const participants_html = this.items_to_html({
                items: participants,
            });
            this.$participants_list.append($(participants_html));
        }

        this.$users_matching_view_list = $(this.matching_view_list_selector);
        if (online_users.length > 0) {
            if ($(`${this.matching_view_list_selector} .empty-list-message`).length > 0) {
                this.$users_matching_view_list.empty();
            }
            const online_users_html = this.items_to_html({
                items: online_users,
            });
            this.$users_matching_view_list.append($(online_users_html));
        }

        this.$other_users_list = $(this.other_user_list_selector);
        if (offline_users.length > 0) {
            if ($(`${this.other_user_list_selector} .empty-list-message`).length > 0) {
                this.$other_users_list.empty();
            }
            const offline_users_html = this.items_to_html({
                items: offline_users,
            });
            this.$other_users_list.append($(offline_users_html));
        }

        this.render_count += more_user_ids.length;
        this.update_padding();
    }

    display_or_hide_sections(): void {
        const {all_participant_ids, hide_headers, total_human_subscribers_count} = this.render_data;

        $("#buddy-list-users-matching-view-container").toggleClass("no-display", hide_headers);
        $("#buddy-list-participants-container").toggleClass("no-display", hide_headers);

        if (
            !hide_headers &&
            total_human_subscribers_count === this.participant_user_ids.length
        ) {
            $("#buddy-list-users-matching-view-container").toggleClass("no-display", true);
        }
    }

    render_view_user_list_links(): void {
        const {current_sub, total_human_subscribers_count, other_users_count} = this.render_data;
        const has_inactive_users_matching_view =
            total_human_subscribers_count >
            this.users_matching_view_ids.length + this.participant_user_ids.length;
        const has_inactive_other_users = other_users_count > this.other_user_ids.length;

        if (
            current_sub &&
            stream_data.can_view_subscribers(current_sub) &&
            has_inactive_users_matching_view
        ) {
            const stream_edit_hash = hash_util.channels_settings_edit_url(
                current_sub,
                "subscribers",
            );
            $("#buddy-list-users-matching-view-container").append(
                $(
                    render_view_all_subscribers({
                        stream_edit_hash,
                    }),
                ),
            );
        }

        if (has_inactive_other_users) {
            $("#buddy-list-other-users-container").append($(render_view_all_users()));
        }
    }

    first_key(): number | undefined {
        if (this.participant_user_ids.length > 0) {
            return this.participant_user_ids[0];
        }
        if (this.users_matching_view_ids.length > 0) {
            return this.users_matching_view_ids[0];
        }
        if (this.other_user_ids.length > 0) {
            return this.other_user_ids[0];
        }
        return undefined;
    }

    prev_key(key: number): number | undefined {
        let i = this.participant_user_ids.indexOf(key);
        if (i > 0) {
            return this.participant_user_ids[i - 1];
        }
        if (i === 0) {
            return undefined;
        }

        i = this.users_matching_view_ids.indexOf(key);
        if (i > 0) {
            return this.users_matching_view_ids[i - 1];
        }
        if (i === 0) {
            if (this.participant_user_ids.length > 0) {
                return this.participant_user_ids.at(-1);
            }
            return undefined;
        }

        i = this.other_user_ids.indexOf(key);
        if (i > 0) {
            return this.other_user_ids[i - 1];
        }
        if (i === 0) {
            if (this.users_matching_view_ids.length > 0) {
                return this.users_matching_view_ids.at(-1);
            }
            if (this.participant_user_ids.length > 0) {
                return this.participant_user_ids.at(-1);
            }
            return undefined;
        }
        blueslip.error("Couldn't find key in buddy list", {
            key,
            participant_user_ids: this.participant_user_ids,
            users_matching_view_ids: this.users_matching_view_ids,
            other_user_ids: this.other_user_ids,
        });
        return undefined;
    }

    next_key(key: number): number | undefined {
        let i = this.participant_user_ids.indexOf(key);
        if (i >= 0 && i === this.participant_user_ids.length - 1) {
            if (this.users_matching_view_ids.length > 0) {
                return this.users_matching_view_ids[0];
            }
            if (this.other_user_ids.length > 0) {
                return this.other_user_ids[0];
            }
            return undefined;
        }
        if (i >= 0) {
            return this.participant_user_ids[i + 1];
        }

        i = this.users_matching_view_ids.indexOf(key);
        if (i >= 0 && i === this.users_matching_view_ids.length - 1) {
            if (this.other_user_ids.length > 0) {
                return this.other_user_ids[0];
            }
            return undefined;
        }
        if (i >= 0) {
            return this.users_matching_view_ids[i + 1];
        }

        i = this.other_user_ids.indexOf(key);
        if (i >= 0 && i === this.other_user_ids.length - 1) {
            return undefined;
        }
        if (i >= 0) {
            return this.other_user_ids[i + 1];
        }

        blueslip.error("Couldn't find key in buddy list", {
            key,
            participant_user_ids: this.participant_user_ids,
            users_matching_view_ids: this.users_matching_view_ids,
            other_user_ids: this.other_user_ids,
        });
        return undefined;
    }

    maybe_remove_user_id(opts: {user_id: number}): void {
        let was_removed = false;
        for (const user_id_list of [
            this.participant_user_ids,
            this.users_matching_view_ids,
            this.other_user_ids,
        ]) {
            const pos = user_id_list.indexOf(opts.user_id);
            if (pos !== -1) {
                user_id_list.splice(pos, 1);
                was_removed = true;
                break;
            }
        }
        if (!was_removed) {
            return;
        }
        const pos = this.all_user_ids.indexOf(opts.user_id);
        this.all_user_ids.splice(pos, 1);

        if (pos < this.render_count) {
            this.render_count -= 1;
            const $li = this.find_li({key: opts.user_id});
            assert($li !== undefined);
            $li.remove();
            this.update_padding();
        }
    }

    find_position(opts: {user_id: number; user_id_list: number[]}): number {
        const user_id = opts.user_id;
        const user_id_list = opts.user_id_list;

        const current_sub = narrow_state.stream_sub();
        const pm_ids_set = narrow_state.pm_ids_set();

        const i = user_id_list.findIndex(
            (list_user_id) =>
                this.compare_function(
                    user_id,
                    list_user_id,
                    current_sub,
                    pm_ids_set,
                    this.render_data.all_participant_ids,
                ) < 0,
        );
        return i === -1 ? user_id_list.length : i;
    }

    force_render(opts: {pos: number}): void {
        const pos = opts.pos;
        const cushion_size = 3;
        const chunk_size = pos + cushion_size - this.render_count;

        if (chunk_size <= 0) {
            blueslip.error("cannot show user id at this position", {
                pos,
                render_count: this.render_count,
                chunk_size,
            });
        }

        this.render_more({
            chunk_size,
        });
    }

    find_li(opts: {key: number; force_render?: boolean}): JQuery | undefined {
        const user_id = opts.key;
        let $li = this.get_li_from_user_id({
            user_id,
        });

        if ($li.length === 1) {
            return $li;
        }

        if (!opts.force_render) {
            return $li;
        }

        const pos = this.all_user_ids.indexOf(user_id);

        if (pos === -1) {
            return undefined;
        }

        this.force_render({
            pos,
        });

        $li = this.get_li_from_user_id({
            user_id,
        });

        return $li;
    }

    insert_new_html(opts: {
        new_user_id: number | undefined;
        html: string;
        is_subscribed_user: boolean;
        is_participant_user: boolean;
    }): void {
        const user_id_following_insertion = opts.new_user_id;
        const html = opts.html;
        const is_subscribed_user = opts.is_subscribed_user;
        const is_participant_user = opts.is_participant_user;

        if (user_id_following_insertion === undefined) {
            if (is_participant_user) {
                this.$participants_list.append($(html));
            } else if (is_subscribed_user) {
                this.$users_matching_view_list.append($(html));
            } else {
                this.$other_users_list.append($(html));
            }
        } else {
            const $li = this.find_li({key: user_id_following_insertion});
            assert($li !== undefined);
            $li.before($(html));
        }

        this.render_count += 1;
        this.update_padding();
    }

    insert_or_move(opts: {user_id: number; item: BuddyUserInfo}): void {
        const user_id = opts.user_id;
        const item = opts.item;

        this.maybe_remove_user_id({user_id});

        const new_pos_in_all_users = this.find_position({
            user_id,
            user_id_list: this.all_user_ids,
        });

        const current_sub = narrow_state.stream_sub();
        const pm_ids_set = narrow_state.pm_ids_set();
        const is_subscribed_user = buddy_data.user_matches_narrow(
            user_id,
            pm_ids_set,
            current_sub?.stream_id,
        );
        let user_id_list;
        if (this.render_data.all_participant_ids.has(user_id)) {
            user_id_list = this.participant_user_ids;
        } else if (is_subscribed_user) {
            user_id_list = this.users_matching_view_ids;
        } else {
            user_id_list = this.other_user_ids;
        }
        const new_pos_in_user_list = this.find_position({
            user_id,
            user_id_list,
        });

        const new_user_id = user_id_list[new_pos_in_user_list];

        user_id_list.splice(new_pos_in_user_list, 0, user_id);
        this.all_user_ids.splice(new_pos_in_all_users, 0, user_id);

        const html = this.item_to_html({item});
        this.insert_new_html({
            html,
            new_user_id,
            is_subscribed_user,
            is_participant_user: this.render_data.all_participant_ids.has(user_id),
        });
    }

    fill_screen_with_content(): void {
        let height = this.height_to_fill();
        const elem = util.the(scroll_util.get_scroll_element($(this.scroll_container_selector)));
        height += 10;

        while (this.render_count < this.all_user_ids.length) {
            const padding_height = $(this.padding_selector).height();
            assert(padding_height !== undefined);
            const bottom_offset = elem.scrollHeight - elem.scrollTop - padding_height;

            if (bottom_offset > height) {
                break;
            }

            const chunk_size = 20;

            this.render_more({
                chunk_size,
            });
        }
        this.render_section_headers();
    }

    start_scroll_handler(): void {
        const $scroll_container = scroll_util.get_scroll_element($(this.scroll_container_selector));

        $scroll_container.on("scroll", () => {
            this.fill_screen_with_content();
        });
    }

    update_padding(): void {
        padded_widget.update_padding({
            shown_rows: this.render_count,
            total_rows: this.all_user_ids.length,
            content_selector: "#buddy_list_wrapper",
            padding_selector: this.padding_selector,
        });
    }
}

export const buddy_list = new BuddyList();
