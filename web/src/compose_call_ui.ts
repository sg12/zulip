import $ from "jquery";
import { z } from "zod";

import * as channel from "./channel.ts";
import * as compose_call from "./compose_call.ts";
import { get_recipient_label } from "./compose_closed_ui.ts";
import * as compose_ui from "./compose_ui.ts";
import { $t, $t_html } from "./i18n.ts";
import * as rows from "./rows.ts";
import { current_user, realm } from "./state_data.ts";
import * as narrow_state from "./narrow_state.ts";
import * as ui_report from "./ui_report.ts";
import * as util from "./util.ts";

import { SignJWT } from 'jose';
import render_audio_iframe from "../templates/audio_iframe.hbs";

let api: any = null;
let isMicMuted = true;
let isCameraMuted = true;
let isScreenSharing = false;

function updateMicIcon() {
    const micIcon = document.querySelector(`[data-stream-id="${narrow_state.stream_id()}"][data-topic-name="${narrow_state.topic()}"] #toggle-mic`);
    if (micIcon) {
        micIcon.className = isMicMuted ? "zulip-icon zulip-icon-mic-off" : "zulip-icon zulip-icon-mic-on";
    }
}

function updateCameraIcon() {
    const cameraIcon = document.querySelector(`[data-stream-id="${narrow_state.stream_id()}"][data-topic-name="${narrow_state.topic()}"] #toggle-camera`);
    if (cameraIcon) {
        cameraIcon.className = isCameraMuted ? "zulip-icon zulip-icon-camera-off" : "zulip-icon zulip-icon-camera-on";
    }
}

function updateScreenIcon() {
    const screenButton = document.querySelector(`[data-stream-id="${narrow_state.stream_id()}"][data-topic-name="${narrow_state.topic()}"] #toggle-screen`);
    if (screenButton) {
        screenButton.style.opacity = isScreenSharing ? "1" : "";
    }
}

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
    const link_text = $t({ defaultMessage: "Join video call." });
    compose_ui.insert_syntax_and_focus(`[${link_text}](${url})`, $target_textarea, "block", 1);
}

function insert_audio_call_url_old(url: string, $target_textarea: JQuery<HTMLTextAreaElement>): void {
    const link_text = $t({ defaultMessage: "Join voice call." });
    compose_ui.insert_syntax_and_focus(`[${link_text}](${url})`, $target_textarea, "block", 1);
}

let defaultVideoX = 0;
let defaultVideoY = 0;
let url_video = "";

function insert_audio_call_url(url: string): void {
    // const container = $("#message_feed_container");
    // container.hide();
    url_video = url;
    let videoContainer = document.getElementById("video-container");

    if (!videoContainer) return;

    videoContainer.style.display = "block"; // Показываем контейнер
    videoContainer.innerHTML = "";

    const loadingBar = document.createElement("div");
    loadingBar.id = "loading-spinner";
    videoContainer.appendChild(loadingBar);

    const rect = videoContainer.getBoundingClientRect();
    videoContainer.style.position = "absolute";
    videoContainer.style.flex = "1";
    // videoContainer.style.position = "fixed";
    
    if (defaultVideoX == 0)
        defaultVideoX = rect.left;
    videoContainer.style.left = `${defaultVideoX}px`;
    if (defaultVideoY == 0)
        videoContainer.style.top = `${defaultVideoY}px`;
    videoContainer.style.zIndex = "9999";
    videoContainer.style.resize = "both";

    const cleanUrl = url.split('#')[0];

    // Вставляем ссылку в iframe с использованием Jitsi Meet API
    const iframeHeight = Math.floor(rect.right - rect.left - 80);
    const iframeWidth = Math.floor(rect.right - rect.left);
    const domain = "jitsi-connectrm.ru:8443";
    const roomName = encodeURIComponent(cleanUrl.split('/').pop()?.split('?')[0] || ""); // Кодируем имя комнаты
    const jwt = encodeURIComponent(cleanUrl.split('jwt=')[1] || ""); // Кодируем JWT
    const options = {
        roomName: roomName,
        width: iframeWidth + "px",
        height: iframeHeight + "px",
        parentNode: videoContainer,
        jwt: jwt,
        configOverwrite: { startWithAudioMuted: true, startWithVideoMuted: true, prejoinConfig: { enabled: false } },
        interfaceConfigOverwrite: {
            TOOLBAR_BUTTONS: [
                'camera',
                'desktop',
                'microphone',
                'settings',
                'fullscreen',
                'hangup'
            ]
        }
    };
    api = new JitsiMeetExternalAPI(domain, options);

    document.querySelector('iframe').setAttribute('allow', 'camera; microphone; fullscreen; display-capture');
    console.log("--------Compose_call_ui");
    // Подписываемся на событие входа в конференцию
    api.addListener('videoConferenceJoined', () => {
        const controls = document.querySelector(`[data-stream-id="${narrow_state.stream_id()}"][data-topic-name="${narrow_state.topic()}"] #custom-controls`);
        if (controls) {
            controls.style.display = "flex";
        }

        // Обработчики событий для кнопок
        document.querySelector(`[data-stream-id="${narrow_state.stream_id()}"][data-topic-name="${narrow_state.topic()}"] #toggle-mic`)?.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            api.executeCommand('toggleAudio');
        });

        document.querySelector(`[data-stream-id="${narrow_state.stream_id()}"][data-topic-name="${narrow_state.topic()}"] #toggle-camera`)?.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            api.executeCommand('toggleVideo');
        });

        document.querySelector(`[data-stream-id="${narrow_state.stream_id()}"][data-topic-name="${narrow_state.topic()}"] #toggle-screen`)?.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            api.executeCommand('toggleShareScreen');
        });
    });

    // Подписываемся на события изменения статуса микрофона, камеры и шаринга экрана
    api.addListener('audioMuteStatusChanged', (event: { muted: boolean }) => {
        isMicMuted = event.muted;
        updateMicIcon();
    });

    api.addListener('videoMuteStatusChanged', (event: { muted: boolean }) => {
        isCameraMuted = event.muted;
        updateCameraIcon();
    });

    api.addListener('screenSharingStatusChanged', (event: { on: boolean }) => {
        isScreenSharing = event.on;
        updateScreenIcon();
    });

    api.addListener('readyToClose', () => {
        if (videoContainer) {
            videoContainer.replaceChildren(); // Удаляет всех дочерних элементов
            videoContainer.innerHTML = ""; //очитска вего (она работает)
            isDragging = false;
            offsetX = 0;
            offsetY = 0;
        }
        updateScreenIcon();
    });

    let isDragging = false;
    let offsetX = 0, offsetY = 0;

    const iframe = document.querySelector('iframe');
    if (iframe) {
        iframe.style.display = "none";
        iframe.addEventListener('load', () => {
            isDragging = false;
            offsetX = 0;
            offsetY = 0;
            const overlay = document.createElement('div');
            overlay.id = 'overlay';
            overlay.style.position = 'absolute';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.width = '100%';
            overlay.style.height = '80%';
            overlay.style.zIndex = '10';
            overlay.style.background = 'transparent';

            videoContainer.appendChild(overlay);

            overlay.addEventListener('mousedown', (e) => {
                console.log('****mousedown detected on overlay');
                isDragging = true;
                offsetX = e.clientX - videoContainer.getBoundingClientRect().left;
                offsetY = e.clientY - videoContainer.getBoundingClientRect().top;
            });

            overlay.addEventListener('mousemove', (e) => {
                if (isDragging) {
                    videoContainer.style.left = `${e.clientX - offsetX}px`;
                    videoContainer.style.top = `${e.clientY - offsetY}px`;
                }
            });

            overlay.addEventListener('mouseup', () => {
                // console.log("--------Compose_call_ui - mouseup");
                isDragging = false;
            });

            // makeResizable(videoContainer);
            // makeResizable(videoContainer, iframe);
            setTimeout(() => {
                const videoContainer = document.getElementById("video-container");
                const iframe = videoContainer?.querySelector("iframe") as HTMLIFrameElement;
                if (videoContainer && iframe) {
                    makeResizable(videoContainer, iframe);
                    addExitButton(videoContainer, iframe);
                    loadingBar.style.display = "none"; // Скрываем бар загрузки
                    iframe.style.display = "block"; 
                }
            }, 1000);
        });
    }

}

function makeResizable(videoContainer: HTMLElement, iframe: HTMLIFrameElement) {
    if (!videoContainer || !iframe) return;

    const resizer = document.createElement("div");
    resizer.style.position = "absolute";
    resizer.style.width = "15px";
    resizer.style.height = "15px";
    resizer.style.cursor = "nwse-resize";
    resizer.style.background = "rgba(0, 0, 0, 0.5)"; // Сделаем его видимым
    resizer.style.zIndex = "10000";
    resizer.style.borderRadius = "3px";

    // Добавляем ресайзер в контейнер
    videoContainer.appendChild(resizer);

    function updateResizerPosition() {
        const iframeRect = iframe.getBoundingClientRect();
        const containerRect = videoContainer.getBoundingClientRect();

        // Позиционируем resizer относительно iframe внутри videoContainer
        resizer.style.left = `${iframeRect.left - containerRect.left + iframeRect.width - 15}px`;
        resizer.style.top = `${iframeRect.top - containerRect.top + iframeRect.height - 15}px`;
    }

    updateResizerPosition(); // Устанавливаем начальную позицию

    let isResizing = false;

    resizer.addEventListener("mousedown", (e) => {
        e.preventDefault();
        isResizing = true;

        let startX = e.clientX;
        let startY = e.clientY;
        let startWidth = iframe.clientWidth;
        let startHeight = iframe.clientHeight;

        function doResize(e: MouseEvent) {
            if (!isResizing) return;

            // Новые размеры iframe
            const newWidth = startWidth + (e.clientX - startX);
            const newHeight = startHeight + (e.clientY - startY);

            iframe.style.width = `${newWidth}px`;
            iframe.style.height = `${newHeight}px`;

            // Подгоняем videoContainer
            videoContainer.style.width = `${newWidth}px`;
            videoContainer.style.height = `${newHeight}px`;

            updateResizerPosition(); // Перемещаем ресайзер
        }

        function stopResize() {
            isResizing = false;
            window.removeEventListener("mousemove", doResize);
            window.removeEventListener("mouseup", stopResize);
        }

        window.addEventListener("mousemove", doResize);
        window.addEventListener("mouseup", stopResize);
    });
}

function addExitButton(videoContainer: HTMLElement, iframe: HTMLIFrameElement) {
    if (!videoContainer || !iframe) return;

    const exitButton = document.createElement("button");
    exitButton.innerText = "✖";
    exitButton.style.position = "absolute";
    exitButton.style.top = "10px";
    exitButton.style.right = "10px";
    exitButton.style.width = "35px";
    exitButton.style.height = "35px";
    exitButton.style.background = "rgba(255, 0, 0, 0.7)";
    exitButton.style.color = "white";
    exitButton.style.border = "none";
    exitButton.style.borderRadius = "50%";
    exitButton.style.cursor = "pointer";
    exitButton.style.zIndex = "10001"; // Выше iframe
    exitButton.style.fontSize = "18px";
    exitButton.style.display = "flex";
    exitButton.style.alignItems = "center";
    exitButton.style.justifyContent = "center";

    // Добавляем кнопку в контейнер
    videoContainer.appendChild(exitButton);

    // Функция выхода (закрытие iframe)
    exitButton.addEventListener("click", () => {
        videoContainer.innerHTML = ""; // Удаляем iframe
        // videoContainer.style.display = "none"; // Скрываем контейнер
        showEnterButton(url_video); // Показываем кнопку "Войти"
    });

    // Обновляем позицию кнопки
    function updateExitButtonPosition() {
        const iframeRect = iframe.getBoundingClientRect();
        const containerRect = videoContainer.getBoundingClientRect();
        exitButton.style.left = `${iframeRect.left - containerRect.left + iframeRect.width - 50}px`;
        exitButton.style.top = `${iframeRect.top - containerRect.top + 10}px`;
    }

    updateExitButtonPosition();
    new ResizeObserver(updateExitButtonPosition).observe(iframe);
}

export function showEnterButton(url: string) {
    const videoContainer = document.getElementById("video-container");
    if (!videoContainer) return;

    const enterButton = document.createElement("button");
    enterButton.innerText = "Войти в видео";
    enterButton.style.position = "absolute"; // Привязываем к экрану, но позиционируем как у videoContainer
    enterButton.style.width = "120px";
    enterButton.style.height = "60px";
    enterButton.style.background = "green";
    enterButton.style.color = "white";
    enterButton.style.border = "none";
    enterButton.style.borderRadius = "5px";
    enterButton.style.cursor = "pointer";
    enterButton.style.fontSize = "16px";
    enterButton.style.zIndex = "10001"; // Поверх всех элементов

    // Удаляем кнопку "Войти", если она уже есть
    const existingButton = document.getElementById("enter-button");
    if (existingButton) {
        existingButton.remove();
    }

    // Добавляем ID для кнопки, чтобы можно было ее легко удалить
    enterButton.id = "enter-button";

    // Добавляем кнопку в body (НЕ внутрь videoContainer!)
    document.body.appendChild(enterButton);

    // Функция обновления позиции кнопки
    function updateEnterButtonPosition() {
        if (!videoContainer) return;
        const rect = videoContainer.getBoundingClientRect();

        // Размещаем кнопку в том же месте, где была кнопка "Выйти"
        enterButton.style.left = `${rect.left + rect.width / 2}px`; // Отступ справа
        enterButton.style.top = `${rect.top + 150}px`; // Отступ сверху
    }

    updateEnterButtonPosition(); // Устанавливаем начальное положение кнопки

    // Обновляем положение кнопки при изменении размера окна
    window.addEventListener("resize", updateEnterButtonPosition);

    // При нажатии создаем конференцию заново
    enterButton.addEventListener("click", () => {
        document.body.removeChild(enterButton); // Удаляем кнопку "Войти"
        insert_audio_call_url(url);
    });
}

export function generate_and_insert_audio_or_video_call_link(
    bbb_url: string
): void {
    let video_call_id = bbb_url;
    if (bbb_url.length < 7) {
        video_call_id = util.random_int(100000000000000, 999999999999999).toString();
    }
    generateToken()
        .then((token) => generate_call_link(video_call_id, token))
        .catch(() => generate_call_link(video_call_id, ""));
}

export function generate_and_insert_audio_or_video_call_link_old(
    $target_element: JQuery,
    is_audio_call: boolean,
    bbb_url: string
): void {
    // let $target_textarea: JQuery<HTMLTextAreaElement>;
    // let edit_message_id: string | undefined;
    // if ($target_element.parents(".message_edit_form").length === 1) {
    //     edit_message_id = rows.id($target_element.parents(".message_row")).toString();
    //     $target_textarea = $(`#edit_form_${CSS.escape(edit_message_id)} .message_edit_content`);
    // } else {
    //     $target_textarea = $<HTMLTextAreaElement>("textarea#compose-textarea");
    // }

    // const available_providers = realm.realm_available_video_chat_providers;

    // if (
    //     available_providers.zoom &&
    //     realm.realm_video_chat_provider === available_providers.zoom.id
    // ) {
    //     compose_call.abort_video_callbacks(edit_message_id);
    //     const key = edit_message_id ?? "";

    //     const request = {
    //         is_video_call: !is_audio_call,
    //     };

    //     const make_zoom_call = (): void => {
    //         const xhr = channel.post({
    //             url: "/json/calls/zoom/create",
    //             data: request,
    //             success(res) {
    //                 const data = call_response_schema.parse(res);
    //                 compose_call.video_call_xhrs.delete(key);
    //                 if (is_audio_call) {
    //                     insert_audio_call_url(data.url, $target_textarea);
    //                 } else {
    //                     insert_video_call_url(data.url, $target_textarea);
    //                 }
    //             },
    //             error(xhr, status) {
    //                 compose_call.video_call_xhrs.delete(key);
    //                 let parsed;
    //                 if (
    //                     status === "error" &&
    //                     (parsed = z.object({code: z.string()}).safeParse(xhr.responseJSON))
    //                         .success &&
    //                     parsed.data.code === "INVALID_ZOOM_TOKEN"
    //                 ) {
    //                     current_user.has_zoom_token = false;
    //                 }
    //                 if (status !== "abort") {
    //                     ui_report.generic_embed_error(
    //                         $t_html({defaultMessage: "Failed to create video call."}),
    //                     );
    //                 }
    //             },
    //         });
    //         if (xhr !== undefined) {
    //             compose_call.video_call_xhrs.set(key, xhr);
    //         }
    //     };

    //     if (current_user.has_zoom_token) {
    //         make_zoom_call();
    //     } else {
    //         compose_call.zoom_token_callbacks.set(key, make_zoom_call);
    //         window.open(
    //             window.location.protocol + "//" + window.location.host + "/calls/zoom/register",
    //             "_blank",
    //             "width=800,height=500,noopener,noreferrer",
    //         );
    //     }
    // } else if (
    //     available_providers.big_blue_button &&
    //     realm.realm_video_chat_provider === available_providers.big_blue_button.id
    // ) {
    //     if (is_audio_call) {
    //         // TODO: Add support for audio-only BigBlueButton calls here.
    //         return;
    //     }
    //     const meeting_name = get_recipient_label() + " meeting";
    //     void channel.get({
    //         url: "/json/calls/bigbluebutton/create",
    //         data: {
    //             meeting_name,
    //         },
    //         success(response) {
    //             const data = call_response_schema.parse(response);
    //             insert_video_call_url(data.url, $target_textarea);
    //         },
    //     });
    // } else {
    // TODO: Use `new URL` to generate the URLs here.


    // const video_call_id = util.random_int(100000000000000, 999999999999999);
    // const token = generate_jitsi_jwt(current_user.email, current_user.full_name);
    console.log("------token bbb_url: ", bbb_url);
    let video_call_id = bbb_url;
    if (bbb_url.length < 3) {
        video_call_id = util.random_int(100000000000000, 999999999999999).toString();
    }
    console.log("------token bbb_url 2: ", video_call_id);
    generateToken()
        .then((token) => generate_call_link(video_call_id, token))
        .catch(() => generate_call_link(video_call_id, ""));

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
    // }
}

function generate_call_link(video_call_id: string, token: String) {
    const video_call_link = compose_call.get_jitsi_server_url() + "/" + video_call_id;
    if (token.length > 0) {
        insert_audio_call_url(
            video_call_link + "?jwt=" + token + "#config.prejoinConfig.enabled=false&config.startWithVideoMuted=true",
        );
    } else {
        insert_audio_call_url(
            video_call_link + "#config.startWithVideoMuted=true",
        );
    }
}

function generate_call_link_old(video_call_id: string, $target_textarea: JQuery<HTMLTextAreaElement>, token: String) {
    const video_call_link = compose_call.get_jitsi_server_url() + "/" + video_call_id;
    // console.log('Generated JWT:', token)
    if (token.length > 0) {
        insert_audio_call_url(
            // video_call_link + "?jwt=" + token + "#config.startWithVideoMuted=true",
            video_call_link + "?jwt=" + token + "#config.prejoinConfig.enabled=false&config.startWithVideoMuted=true",
            $target_textarea,
        );
    } else {
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
