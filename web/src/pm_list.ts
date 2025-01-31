import $ from "jquery";
import _ from "lodash";
import {z} from "zod";

import type {Filter} from "./filter.ts";
import {localstorage} from "./localstorage.ts";
import * as pm_list_data from "./pm_list_data.ts";
import * as pm_list_dom from "./pm_list_dom.ts";
import type {PMNode} from "./pm_list_dom.ts";
import * as resize from "./resize.ts";
import * as scroll_util from "./scroll_util.ts";
import * as ui_util from "./ui_util.ts";
import type {FullUnreadCountsData} from "./unread.ts";
import * as vdom from "./vdom.ts";

// import { toggle_sidebar_user_card_popover } from "./user_card_popover";

let prior_dom: vdom.Tag<PMNode> | undefined;

// This module manages the direct messages section in the upper
// left corner of the app.  This was split out from stream_list.ts.

const ls_key = "left_sidebar_direct_messages_collapsed_state";
const ls_schema = z.boolean().default(false);
const ls = localstorage();
let private_messages_collapsed = false;

// The direct messages section can be zoomed in to view more messages.
// This keeps track of if we're zoomed in or not.
let zoomed = false;

export function is_zoomed_in(): boolean {
    return zoomed;
}

function get_private_messages_section_header(): JQuery {
    return $("#direct-messages-section-header");
}

export function set_count(count: number): void {
    ui_util.update_unread_count_in_dom(get_private_messages_section_header(), count);
}

export function close(): void {
    private_messages_collapsed = true;
    ls.set(ls_key, private_messages_collapsed);
    $("#toggle-direct-messages-section-icon").removeClass("rotate-icon-down");
    $("#toggle-direct-messages-section-icon").addClass("rotate-icon-right");

    update_private_messages();
}

async function getConversationsWithPinned(force = false): Promise<{ pinned, others }> {
    const conversations = pm_list_data.get_conversations();
    const pinned_conversations = await pm_list_data.getPinnedConversations(force);

    const pinned = [];
    const others = [];

    for (const conversation of conversations) {
        if (pinned_conversations.includes(conversation.user_ids_string)) {
            pinned.push(conversation);
        } else {
            others.push(conversation);
        }
    }

    return { pinned, others };
}

export async function _build_direct_messages_list(force = false): Promise<vdom.Tag<PMNode>> {
    const { pinned, others } = await getConversationsWithPinned(force);

    const pm_list_nodes = [];

    if (pinned.length > 0) {
        pm_list_nodes.push(pm_list_dom.pm_subheader("Pinned"));
        for (const conversation of pinned) {
            pm_list_nodes.push(pm_list_dom.keyed_pm_li(conversation));
        }
    }

    if (others.length > 0) {
        pm_list_nodes.push(pm_list_dom.pm_subheader("All"));
        for (const conversation of others) {
            pm_list_nodes.push(pm_list_dom.keyed_pm_li(conversation));
        }
    }

    const dom_ast = pm_list_dom.pm_ul(pm_list_nodes);

    return dom_ast;
}

function set_dom_to(new_dom: vdom.Tag<PMNode>): void {
    const $container = scroll_util.get_content_element($("#direct-messages-list"));

    function replace_content(html: string): void {
        $container.html(html);
    }

    function find(): JQuery {
        return $container.find("ul");
    }

    vdom.update(replace_content, find, new_dom, prior_dom);
    prior_dom = new_dom;
}

export async function update_private_messages(force = false): Promise<void> {
    if (private_messages_collapsed) {
        // In the collapsed state, we will still display the current
        // conversation, to preserve the UI invariant that there's
        // always something highlighted in the left sidebar.
        const conversations = pm_list_data.get_conversations();
        const active_conversation = conversations.find((conversation) => conversation.is_active);

        if (active_conversation) {
            const node = [pm_list_dom.keyed_pm_li(active_conversation)];
            const new_dom = pm_list_dom.pm_ul(node);
            set_dom_to(new_dom);
        } else {
            // Otherwise, empty the section.
            $(".dm-list").empty();
            prior_dom = undefined;
        }
    } else {
        const new_dom = await _build_direct_messages_list(force);
        set_dom_to(new_dom);
    }
    // Make sure to update the left sidebar heights after updating
    // direct messages.
    setTimeout(resize.resize_stream_filters_container, 0);
}

export function expand(): void {
    private_messages_collapsed = false;
    ls.set(ls_key, private_messages_collapsed);

    $("#toggle-direct-messages-section-icon").addClass("rotate-icon-down");
    $("#toggle-direct-messages-section-icon").removeClass("rotate-icon-right");
    update_private_messages();
}

export function update_dom_with_unread_counts(counts: FullUnreadCountsData): void {
    // In theory, we could support passing the counts object through
    // to pm_list_data, rather than fetching it directly there. But
    // it's not an important optimization, because it's unlikely a
    // user would have 10,000s of unread direct messages where it
    // could matter.
    update_private_messages();
    // This is just the global unread count.
    set_count(counts.direct_message_count);
}

export function highlight_all_private_messages_view(): void {
    $(".direct-messages-container").addClass("active-direct-messages-section");
}

function unhighlight_all_private_messages_view(): void {
    $(".direct-messages-container").removeClass("active-direct-messages-section");
}

function scroll_pm_into_view($target_li: JQuery): void {
    const $container = $("#left_sidebar_scroll_container");
    const pm_header_height = $("#direct-messages-section-header").outerHeight();
    if ($target_li.length > 0) {
        scroll_util.scroll_element_into_container($target_li, $container, pm_header_height);
    }
}

function scroll_all_private_into_view(): void {
    const $container = $("#left_sidebar_scroll_container");
    const $scroll_element = scroll_util.get_scroll_element($container);
    $scroll_element.scrollTop(0);
}

export function handle_narrow_activated(filter: Filter): void {
    const active_filter = filter;
    const is_all_private_message_view = _.isEqual(active_filter.sorted_term_types(), ["is-dm"]);
    const narrow_to_private_messages_section = active_filter.operands("dm").length > 0;
    const is_private_messages_in_view = active_filter.has_operator("dm");

    if (is_all_private_message_view) {
        // In theory, this should get expanded when we scroll to the
        // top, but empirically that doesn't occur, so we just ensure the
        // section is expanded before scrolling.
        expand();
        highlight_all_private_messages_view();
        scroll_all_private_into_view();
    } else {
        unhighlight_all_private_messages_view();
    }
    if (narrow_to_private_messages_section) {
        const current_user_ids_string = pm_list_data.get_active_user_ids_string();
        if (current_user_ids_string !== undefined) {
            const $active_filter_li = $(
                `li[data-user-ids-string='${CSS.escape(current_user_ids_string)}']`,
            );
            scroll_pm_into_view($active_filter_li);
        }
        update_private_messages();
    } else if (!is_private_messages_in_view) {
        update_private_messages();
    }
}

export function handle_message_view_deactivated(): void {
    // Since one can renarrow via the keyboard shortcut or similar, we
    // avoid disturbing the zoomed state here.
    unhighlight_all_private_messages_view();
    update_private_messages();
}

export function is_private_messages_collapsed(): boolean {
    return private_messages_collapsed;
}

export function toggle_private_messages_section(): void {
    // change the state of direct message section depending on
    // the previous state.
    if (private_messages_collapsed) {
        expand();
    } else {
        close();
    }
}

function zoom_in(): void {
    zoomed = true;
    update_private_messages();
    $(".direct-messages-container").removeClass("zoom-out").addClass("zoom-in");
    $("#streams_list").hide();
    $(".left-sidebar .right-sidebar-items").hide();

    const $filter = $(".direct-messages-list-filter").expectOne();
    $filter.trigger("focus");
}

function zoom_out(): void {
    zoomed = false;
    clear_search(true); // force rerender if the search is empty.
    $(".direct-messages-container").removeClass("zoom-in").addClass("zoom-out");
    $("#streams_list").show();
    $(".left-sidebar .right-sidebar-items").show();
}

export function clear_search(force_rerender = false): void {
    const $filter = $(".direct-messages-list-filter").expectOne();
    if ($filter.val() !== "") {
        $filter.val("");
        update_private_messages();
    } else if (force_rerender) {
        update_private_messages();
    }
    $filter.trigger("blur");
}

export function initialize(): void {
    // Restore collapsed status.
    private_messages_collapsed = ls_schema.parse(ls.get(ls_key));
    if (private_messages_collapsed) {
        close();
    } else {
        expand();
    }

    const throttled_update_private_message = _.throttle(update_private_messages, 50);
    $(".direct-messages-container").on("click", "#show-more-direct-messages", (e) => {
        e.stopPropagation();
        e.preventDefault();

        zoom_in();
    });

    $(".direct-messages-container").on("click", "#hide-more-direct-messages", (e) => {
        e.stopPropagation();
        e.preventDefault();

        zoom_out();
    });

    $(".direct-messages-container").on("input", ".direct-messages-list-filter", (e) => {
        e.stopPropagation();
        e.preventDefault();

        throttled_update_private_message();
    });

    $(".direct-messages-container").on("click", "#clear-direct-messages-search-button", (e) => {
        e.stopPropagation();
        e.preventDefault();

        clear_search();
    });

    $(".direct-messages-container").on("mouseenter", () => {
        $("#direct-messages-section-header").addClass("hover-over-dm-section");
    });

    $(".direct-messages-container").on("mouseleave", () => {
        $("#direct-messages-section-header").removeClass("hover-over-dm-section");
    });

    // Добавляем обработчик для кнопки меню
    // $(".direct-messages-container").on("click", ".dm-sidebar-menu-icon", (e) => {
    //     e.stopPropagation();

    //     const $target = $(e.currentTarget).closest("li");

    //     // Вызов функции из user_card_popover.ts
    //     toggle_sidebar_user_card_popover($target);
    // });

    // $(".buddy-list-section").on("click", ".user-list-sidebar-menu-icon", (e) => {
    //     e.stopPropagation();
    //     const $target = $(e.currentTarget).closest("li");

    //     toggle_sidebar_user_card_popover($target);
    // });
}
