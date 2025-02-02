import $ from "jquery";
import * as compose_call from "./compose_call.ts";
import { current_user } from "./state_data.ts";
import * as narrow_state from "./narrow_state.ts";
import * as util from "./util.ts";

import { SignJWT } from 'jose';

let api: any = null;
let isMicMuted = true;
let isCameraMuted = true;
let isScreenSharing = false;
let url_video = "";
let topicNameVideo = "";
let videoContainer: HTMLElement;
let isFloatingVideo = false;
export let CURRENT_TOPIC_CHARNAME: string = "";

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


function insert_audio_call_url(url: string): void {
    url_video = url;
    // let videoContainer = document.getElementById("floating-video-container");
    if (!videoContainer) initVideoContainer();
    if (!videoContainer) return;

    const videoStaticContainer = document.getElementById("video-container");
    if (videoStaticContainer)
        showLoadBar(videoStaticContainer);

    updateVideoFramePosition();
    // console.log("-------videoContainer.style.left: " + videoContainer.style.left);
    videoContainer.innerHTML = "";
    const cleanUrl = url.split('#')[0];
    // // Вставляем ссылку в iframe с использованием Jitsi Meet API
    const domain = "jitsi-connectrm.ru:8443";
    const roomName = encodeURIComponent(cleanUrl.split('/').pop()?.split('?')[0] || ""); // Кодируем имя комнаты
    const jwt = encodeURIComponent(cleanUrl.split('jwt=')[1] || ""); // Кодируем JWT
    const options = {
        roomName: roomName,
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

    CURRENT_TOPIC_CHARNAME = topicNameToChar(topicNameVideo);

    const columnMiddle = document.getElementById("video-container");
    const resizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(updateVideoFramePosition);
    });

    if (columnMiddle)
        resizeObserver.observe(columnMiddle);
    // new ResizeObserver(updateVideoFramePosition).observe(columnMiddle);

    addListenersVideo();

    const iframe = document.querySelector('iframe');
    if (iframe) {
        iframe.style.display = "none";
        iframe.addEventListener('load', () => {
            setTimeout(() => {
                const iframe = videoContainer.querySelector("iframe") as HTMLIFrameElement;
                if (iframe) {
                    // makeResizable(videoContainer, iframe);
                    // addExitButton();
                    // addTestButton();
                    // loadingBar.style.display = "none"; // Скрываем бар загрузки
                    removeLoadBar();
                    iframe.style.display = "block";
                    // handleOverlayMouseEvents(videoContainer, overlay, iframe);
                    // logAbsolutePositions();
                }
            }, 1000);
        });
    }

}

function addListenersVideo() {
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
        }
        showEnterButton(url_video, topicNameVideo);
        updateScreenIcon();
    });
}

function initVideoContainer() {
    var htmlDoc = document.getElementById("floating-video-container");
    if (htmlDoc) {
        videoContainer = htmlDoc;
        videoContainer.style.display = "block"; // Показываем контейнер
        videoContainer.style.zIndex = "9999";
        videoContainer.style.position = "fixed";
        // videoContainer.style.background = "rgba(0, 0, 0, 0.1)";
        // videoContainer.style.borderRadius = "10px";
        // videoContainer.style.boxShadow = "0px 4px 10px rgba(0, 0, 0, 0.05)";
        isFloatingVideo = false;
    }
}

function updateVideoFramePosition() {
    if (!videoContainer)
        return;
    if (!isFloatingVideo) {
        const columnMiddle = document.getElementById("column-middle-container");
        const rightSidebar = document.getElementById("right-sidebar-container");
        const settingsContent = document.getElementById("settings_content");
        const columnMiddlePosition = getAbsolutePosition(columnMiddle, "column-middle-container");
        const rightSidebarPosition = getAbsolutePosition(rightSidebar, "right-sidebar-container");
        const settingsContentPosition = getAbsolutePosition(settingsContent, "settings_conten");
        const iframeLeft = columnMiddlePosition?.x + columnMiddlePosition?.width;
        const iframeTop = columnMiddlePosition?.y + settingsContentPosition?.y - window.scrollY;
        let iframeWidth = (rightSidebarPosition?.x - iframeLeft);
        if (iframeWidth >= window.innerWidth * 0.33)
            iframeWidth = window.innerWidth * 0.33;
        if (rightSidebarPosition?.width == 0)
            iframeWidth = window.innerWidth * 0.45;
        const iframeHeight = window.innerHeight * 75 / 100;
        videoContainer.style.left = `${iframeLeft + 5}px`;
        videoContainer.style.width = `${iframeWidth}px`;
        videoContainer.style.top = `${iframeTop + 12}px`;
        videoContainer.style.height = `${iframeHeight}px`;
    } else {
        // videoContainer.style.removeProperty("top");
        // videoContainer.style.removeProperty("left");
        videoContainer.style.width = "320px";
        videoContainer.style.height = "160px";
        videoContainer.style.bottom = "20px";
        videoContainer.style.right = "20px";
    }
}

export function restoreVideoPosition() {
    videoContainer.style.removeProperty("bottom");
    videoContainer.style.removeProperty("right");
    isFloatingVideo = false;
    updateVideoFramePosition(); 
}

export function topicNameToChar(topicName): string {
    return topicName.split('').map(char => char.charCodeAt(0)).join('');
}

function moveVideoToCorner() {
    videoContainer.style.removeProperty("top");
    videoContainer.style.removeProperty("left");
    // videoContainer.style.width = "320px";
    // videoContainer.style.height = "160px";
    // videoContainer.style.bottom = "20px";
    // videoContainer.style.right = "20px";
    // videoContainer.style.zIndex = "10003"; // Поверх всех элементов
    isFloatingVideo = true;
    updateVideoFramePosition();
}

export function clickLeftSidebar(isSameTopic: boolean) {
    if (!isShowingVideo()) {
        if (isSameTopic) return; // if the same topic, but have no video, so need sho buttons
        clearButtonsAndPropsForVideo();
        return;
    }
    if (!isSameTopic && !isFloatingVideo)
        moveVideoToCorner();
    else if (isSameTopic && isFloatingVideo)
        restoreVideoPosition();
}

export function isShowingVideo(): boolean {
    if (videoContainer && videoContainer.querySelector("iframe"))
        return true;
    else
        return false;
}

function clearButtonsAndPropsForVideo() {
    const enterButton = document.getElementById("enter-button");
    if (enterButton) enterButton.remove();
    const topicLabel = document.getElementById("topic-label");
    if (topicLabel) topicLabel.remove();
    removeLoadBar();
}

function showLoadBar(loadContainer: HTMLElement) {
    const loadingBar = document.createElement("div");
    loadingBar.id = "loading-spinner";
    const rect = loadContainer?.getBoundingClientRect();
    if (rect) {
        loadingBar.style.left = `${rect.left + rect.width / 2 - 50}px`; // Отступ справа
        loadingBar.style.top = `${200}px`; // Отступ сверху
    }
    loadContainer?.appendChild(loadingBar);
}

function removeLoadBar() {
    const loadingBar = document.getElementById("loading-spinner");
    if (loadingBar)
        loadingBar.remove();
}

function addTestButton() {
    const testButton = document.createElement("button");
    testButton.innerText = "!";
    testButton.style.position = "fixed";
    testButton.style.width = "35px";
    testButton.style.height = "35px";
    testButton.style.background = "rgba(255, 0, 0, 0.7)";
    testButton.style.color = "white";
    testButton.style.border = "none";
    testButton.style.borderRadius = "50%";
    testButton.style.cursor = "pointer";
    testButton.style.zIndex = "10001"; // Выше iframe
    testButton.style.fontSize = "18px";

    // Добавляем кнопку в контейнер
    videoContainer.appendChild(testButton);

    testButton.addEventListener("click", () => {
        if (isFloatingVideo) restoreVideoPosition();
        else moveVideoToCorner();
    });

    // Обновляем позицию кнопки
    function updateTestButtonPosition() {
        const rect = videoContainer.getBoundingClientRect();
        testButton.style.left = `${rect.left + rect.width - 80}px`;
        testButton.style.top = `${rect.top + 10}px`;
    }

    updateTestButtonPosition();
    new ResizeObserver(updateTestButtonPosition).observe(videoContainer);
}

function getAbsolutePosition(element: any, name: string) {
    if (!element) {
        console.error(`❌ Элемент ${name} не найден!`);
        return null;
    }

    const rect = element.getBoundingClientRect();
    const absoluteX = rect.left + window.scrollX;
    const absoluteY = rect.top + window.scrollY;// + getCSSVariableValue('--header-padding-bottom');

    // console.log(`📍 [${name}] Абсолютные координаты: X=${absoluteX}, Y=${absoluteY}, Width=${rect.width}, Height=${rect.height}`);

    // const headerPaddingBottom = getCSSVariableValue('--header-padding-bottom');
    // console.log("🎯 Значение --header-padding-bottom:", headerPaddingBottom);

    return { x: absoluteX, y: absoluteY, width: rect.width, height: rect.height };
}

function addExitButton() {
    const exitButton = document.createElement("button");
    exitButton.innerText = "✖";

    exitButton.style.position = "fixed";
    exitButton.style.width = "35px";
    exitButton.style.height = "35px";
    exitButton.style.background = "rgba(255, 0, 0, 0.7)";
    exitButton.style.color = "white";
    exitButton.style.border = "none";
    exitButton.style.borderRadius = "50%";
    exitButton.style.cursor = "pointer";
    exitButton.style.zIndex = "10001"; // Выше iframe
    exitButton.style.fontSize = "18px";

    // Добавляем кнопку в контейнер
    videoContainer.appendChild(exitButton);

    // Функция выхода (закрытие iframe)
    exitButton.addEventListener("click", () => {
        videoContainer.innerHTML = ""; // Удаляем iframe
        // videoContainer.style.display = "none"; // Скрываем контейнер
        showEnterButton(url_video, topicNameVideo); // Показываем кнопку "Войти"
    });

    function updateExitButtonPosition() {
        if (!videoContainer) return;
        const rect = videoContainer.getBoundingClientRect();
        exitButton.style.left = `${rect.left + rect.width - 40}px`;
        exitButton.style.top = `${rect.top + 10}px`;
    }

    updateExitButtonPosition();
    new ResizeObserver(updateExitButtonPosition).observe(videoContainer);
}

export function showEnterButton(url: string, topic_name: string) {
    topicNameVideo = topic_name;
    if (!videoContainer) initVideoContainer();
    if (!videoContainer) return;

    videoContainer.innerHTML = ""; //очитска вего (она работает)

    updateVideoFramePosition();

    const container = document.getElementById("floating-video-container");
    if (!container) return;

    // Удаляем старую кнопку и надпись, если они есть
    const existingButton = document.getElementById("enter-button");
    if (existingButton) existingButton.remove();
    const existingLabel = document.getElementById("topic-label");
    if (existingLabel) existingLabel.remove();

    // Создаем надпись с темой
    const topicLabel = document.createElement("div");
    topicLabel.innerText = topicNameVideo;
    topicLabel.style.position = "fixed";
    topicLabel.style.fontSize = "18px";
    topicLabel.style.fontWeight = "bold";
    topicLabel.style.color = "black";
    topicLabel.style.zIndex = "10001";
    topicLabel.id = "topic-label";

    // Создаем кнопку
    const enterButton = document.createElement("button");
    enterButton.innerText = "Войти в видео";
    enterButton.style.position = "fixed";
    enterButton.style.width = "120px";
    enterButton.style.height = "60px";
    enterButton.style.background = "green";
    enterButton.style.color = "white";
    enterButton.style.border = "none";
    enterButton.style.borderRadius = "5px";
    enterButton.style.cursor = "pointer";
    enterButton.style.fontSize = "16px";
    enterButton.style.zIndex = "10001";
    enterButton.id = "enter-button";

    // Добавляем элементы в body
    document.body.appendChild(topicLabel);
    document.body.appendChild(enterButton);

    // Функция обновления позиции
    function updatePositions() {
        if (!videoContainer) return;
        const rect = videoContainer.getBoundingClientRect();
        enterButton.style.left = `${rect.left + rect.width / 2 - 60}px`;
        enterButton.style.top = `${150}px`;
        topicLabel.style.left = `${rect.left + rect.width / 2 - topicLabel.offsetWidth / 2}px`;
        topicLabel.style.top = `${120}px`;
    }

    updatePositions();
    window.addEventListener("resize", updatePositions);

    enterButton.addEventListener("click", () => {
        document.body.removeChild(enterButton);
        document.body.removeChild(topicLabel);
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
