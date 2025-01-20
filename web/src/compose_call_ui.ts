import $ from "jquery";
import {z} from "zod";

import * as channel from "./channel.ts";
import * as compose_call from "./compose_call.ts";
import {get_recipient_label} from "./compose_closed_ui.ts";
import * as compose_ui from "./compose_ui.ts";
import {$t, $t_html} from "./i18n.ts";
import * as rows from "./rows.ts";
import {current_user, realm} from "./state_data.ts";
import * as ui_report from "./ui_report.ts";
import * as util from "./util.ts";

import { SignJWT } from 'jose';

const call_response_schema = z.object({
    msg: z.string(),
    result: z.string(),
    url: z.string(),
});

export function update_audio_and_video_chat_button_display(): void {
    update_audio_chat_button_display();
    update_video_chat_button_display();
}

export function update_video_chat_button_display(): void {
    const show_video_chat_button = compose_call.compute_show_video_chat_button();
    $(".compose-control-buttons-container .video_link").toggle(show_video_chat_button);
    $(".message-edit-feature-group .video_link").toggle(show_video_chat_button);
}

export function update_audio_chat_button_display(): void {
    const show_audio_chat_button = compose_call.compute_show_audio_chat_button();
    $(".compose-control-buttons-container .audio_link").toggle(show_audio_chat_button);
    $(".message-edit-feature-group .audio_link").toggle(show_audio_chat_button);
}

function insert_video_call_url(url: string, $target_textarea: JQuery<HTMLTextAreaElement>): void {
    const link_text = $t({defaultMessage: "Join video call."});
    compose_ui.insert_syntax_and_focus(`[${link_text}](${url})`, $target_textarea, "block", 1);
}

function insert_audio_call_url(url: string, $target_textarea: JQuery<HTMLTextAreaElement>): void {
    const link_text = $t({defaultMessage: "Join voice call."});
    compose_ui.insert_syntax_and_focus(`[${link_text}](${url})`, $target_textarea, "block", 1);
}

export function generate_and_insert_audio_or_video_call_link(
    $target_element: JQuery,
    is_audio_call: boolean,
    bbb_url: string
): void {
    let $target_textarea: JQuery<HTMLTextAreaElement>;
    let edit_message_id: string | undefined;
    if ($target_element.parents(".message_edit_form").length === 1) {
        edit_message_id = rows.id($target_element.parents(".message_row")).toString();
        $target_textarea = $(`#edit_form_${CSS.escape(edit_message_id)} .message_edit_content`);
    } else {
        $target_textarea = $<HTMLTextAreaElement>("textarea#compose-textarea");
    }

    const available_providers = realm.realm_available_video_chat_providers;

    if (
        available_providers.zoom &&
        realm.realm_video_chat_provider === available_providers.zoom.id
    ) {
        compose_call.abort_video_callbacks(edit_message_id);
        const key = edit_message_id ?? "";

        const request = {
            is_video_call: !is_audio_call,
        };

        const make_zoom_call = (): void => {
            const xhr = channel.post({
                url: "/json/calls/zoom/create",
                data: request,
                success(res) {
                    const data = call_response_schema.parse(res);
                    compose_call.video_call_xhrs.delete(key);
                    if (is_audio_call) {
                        insert_audio_call_url(data.url, $target_textarea);
                    } else {
                        insert_video_call_url(data.url, $target_textarea);
                    }
                },
                error(xhr, status) {
                    compose_call.video_call_xhrs.delete(key);
                    let parsed;
                    if (
                        status === "error" &&
                        (parsed = z.object({code: z.string()}).safeParse(xhr.responseJSON))
                            .success &&
                        parsed.data.code === "INVALID_ZOOM_TOKEN"
                    ) {
                        current_user.has_zoom_token = false;
                    }
                    if (status !== "abort") {
                        ui_report.generic_embed_error(
                            $t_html({defaultMessage: "Failed to create video call."}),
                        );
                    }
                },
            });
            if (xhr !== undefined) {
                compose_call.video_call_xhrs.set(key, xhr);
            }
        };

        if (current_user.has_zoom_token) {
            make_zoom_call();
        } else {
            compose_call.zoom_token_callbacks.set(key, make_zoom_call);
            window.open(
                window.location.protocol + "//" + window.location.host + "/calls/zoom/register",
                "_blank",
                "width=800,height=500,noopener,noreferrer",
            );
        }
    } else if (
        available_providers.big_blue_button &&
        realm.realm_video_chat_provider === available_providers.big_blue_button.id
    ) {
        if (is_audio_call) {
            // TODO: Add support for audio-only BigBlueButton calls here.
            return;
        }
        const meeting_name = get_recipient_label() + " meeting";
        void channel.get({
            url: "/json/calls/bigbluebutton/create",
            data: {
                meeting_name,
            },
            success(response) {
                const data = call_response_schema.parse(response);
                insert_video_call_url(data.url, $target_textarea);
            },
        });
    } else {
        // TODO: Use `new URL` to generate the URLs here.
        

        // const video_call_id = util.random_int(100000000000000, 999999999999999);
        // const token = generate_jitsi_jwt(current_user.email, current_user.full_name);
        console.log("------token bbb_url", bbb_url);
        let video_call_id = bbb_url;
        if(bbb_url.length < 3) {
            video_call_id = util.random_int(100000000000000, 999999999999999).toString();
        }
        generateToken()
        .then((token) => generate_call_link(video_call_id,$target_textarea,token))
        .catch(() => generate_call_link(video_call_id,$target_textarea,""));

        // const video_call_link = compose_call.get_jitsi_server_url() + "/" + video_call_id;
        // // if (is_audio_call) {
        // insert_audio_call_url(
        //     video_call_link + "?jwt=" + token + "#config.startWithVideoMuted=true",
        //     $target_textarea,
        // );
        // } else {
        //     /* Because Jitsi remembers what last call type you joined
        //        in browser local storage, we need to specify that video
        //        should not be muted in the video call case, or your
        //        next call will also join without video after joining an
        //        audio-only call.

        //        This has the annoying downside that it requires users
        //        who have a personal preference to disable video every
        //        time, but Jitsi's UI makes that very easy to do, and
        //        that inconvenience is probably less important than letting
        //        the person organizing a call specify their intended
        //        call type (video vs audio).
        //    */
        //     insert_video_call_url(
        //         video_call_link + "#config.startWithVideoMuted=false",
        //         $target_textarea,
        //     );
        // }
    }
}

function generate_call_link(video_call_id: string, $target_textarea: JQuery<HTMLTextAreaElement>, token: String){
    const video_call_link = compose_call.get_jitsi_server_url() + "/" + video_call_id;
    console.log('Generated JWT:', token)
    if (token.length>0) {
        insert_audio_call_url(
            // video_call_link + "?jwt=" + token + "#config.startWithVideoMuted=true",
            video_call_link + "?jwt=" + token + "#config.prejoinConfig.enabled=false",
            $target_textarea,
        );
    }else{
        insert_audio_call_url(
            video_call_link + "#config.startWithVideoMuted=true",
            $target_textarea,
        );
    }
}


// function generate_jitsi_jwt(userEmail: string, full_name: string): string {
//     const appId = "connectrm_svz";
//     const appSecret = "HguV/8QBrJdCih2Ycpoz0g5q5m85apT3Nu6E+lDvufg=";
//     const payload = {
//         aud: appId,
//         iss: appId,
//         sub: "joinrm-svz.ru",
//         room: "*",
//         exp: Math.floor(Date.now() / 1000) + 3600, // Текущее время + 1 час (в секундах)
//         context: {
//             user: {
//                 email: userEmail,
//                 name: full_name,
//                 id: userEmail,
//                 avatar: "https://e7.pngegg.com/pngimages/971/686/png-clipart-computer-icons-social-media-blog-avatar-material-service-logo.png",
//             }
//         }
//     };

//     // Генерация токена
//     const token = jwt.sign(payload, appSecret, { algorithm: "HS256" });
//     return token;
// }

// async function generateToken(): Promise<string> {
//     const secret = new TextEncoder().encode("HguV/8QBrJdCih2Ycpoz0g5q5m85apT3Nu6E+lDvufg=");
//     const token = await new SignJWT({
//         app_id: 'connectrm_svz',
//     })
//       .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
//       .setIssuedAt()
//       .setExpirationTime('20h')
//       .sign(secret);
//     return token;
// }

async function generateToken(): Promise<string> {
    try {
        const secret = new TextEncoder().encode("HguV/8QBrJdCih2Ycpoz0g5q5m85apT3Nu6E+lDvufg="); // Используйте переменную окружения
        const token = await new SignJWT({
            context: {
                user: {
                    name: current_user.full_name,
                    id: current_user.email, 
                    email: current_user.email,
                    avatar: "https://e7.pngegg.com/pngimages/971/686/png-clipart-computer-icons-social-media-blog-avatar-material-service-logo.png" //optional
                }
            },
            app_id: 'connectrm_svz',
            aud: 'jitsi',
            iss: 'connectrm_svz',
            sub: 'jitsi-connectrm.ru',
            room: '*',
        })
            .setProtectedHeader({ alg: 'HS256', typ: 'JWT' }) // Заголовок
            .setIssuedAt() // Время выпуска
            .setExpirationTime('20h') // Срок действия
            .sign(secret); // Подпись
        return token;
    } catch (error) {
        console.error('Error generating token:', error);
        return "";
    }
}