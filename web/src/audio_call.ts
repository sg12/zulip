import $ from "jquery";
import * as narrow_state from "./narrow_state.ts";

let callUrl: string | null = null;
let isInAudioChannel = false;
let api: any = null;
let isMicMuted = true;
let isCameraMuted = true;
let isScreenSharing = false;

function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Извлекаем последнюю ссылку на видеозвонок из чата
function searchForLink() {
    const messageLinks = $(".message_content a").get().reverse(); // Перебираем элементы в обратном порядке
    for (const link of messageLinks) {
        const href = $(link).attr("href");
        if (href && href.includes("jitsi-connectrm.ru")) {
            callUrl = href;
            break; // Прерываем цикл, если нашли ссылку
        }
    }
}

function updateMicIcon() {
    const micIcon = document.querySelector(`[data-stream-id="${narrow_state.stream_id()}"][data-topic-name="${narrow_state.topic()}"] #toggle-mic`);
    console.log(micIcon);
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

export async function enterAudioChannel() {
    try {
        callUrl = null; // Сбрасываем ссылку на видеозвонок
        const container = document.getElementById("audio-call-container");
        if (!container) {
            console.error("Element with id 'audio-call-container' not found");
            return;
        }

        if (!callUrl) {
            searchForLink();
        }

        if (!callUrl) {
            $("#left_bar_compose_reply_button_big").click(); // Открываем чат для вставки ссылки
            await delay(100); // Добавляем задержку, чтобы чат успел открыться

            $(".video_link").click(); // Генерируем ссылку
            await delay(100);

            $("#compose-send-button").click(); // Отправляем сообщение с ссылкой

            // Извлекаем ссылку из отправленного сообщения
            searchForLink();
        }

        // Получаем максимальную высоту окна браузера и ставим 75 процентов
        const maxHeight = window.innerHeight;
        const iframeHeight = Math.floor(maxHeight * 0.75);

        // Вставляем ссылку в iframe с использованием Jitsi Meet API
        const domain = "jitsi-connectrm.ru:8443";
        const options = {
            roomName: callUrl.split('/').pop()?.split('?')[0], // Извлекаем имя комнаты из URL
            width: "100%",
            height: iframeHeight + "px",
            parentNode: container,
            jwt: callUrl.split('jwt=')[1], // Извлекаем JWT из URL
            configOverwrite: { startWithAudioMuted: true, startWithVideoMuted: true, prejoinConfig: { enabled: false } },
            interfaceConfigOverwrite: {
                TOOLBAR_BUTTONS: [
                    'camera',
                    'desktop',
                    'microphone',
                    'chat',
                    'settings',
                    'fullscreen'
                ]
            }
        };
        api = new JitsiMeetExternalAPI(domain, options);

        // Подписываемся на событие входа в конференцию
        api.addListener('videoConferenceJoined', () => {
            isInAudioChannel = true;
            // Обновляем отображение кнопок управления
            const controls = document.querySelector(`[data-stream-id="${narrow_state.stream_id()}"][data-topic-name="${narrow_state.topic()}"] #custom-controls`);
            if (controls) {
                controls.style.display = "flex";
            }

            // Обработчики событий для кнопок
            document.querySelector(`[data-stream-id="${narrow_state.stream_id()}"][data-topic-name="${narrow_state.topic()}"] #toggle-mic`)?.addEventListener("click", () => {
                api.executeCommand('toggleAudio');
            });

            document.querySelector(`[data-stream-id="${narrow_state.stream_id()}"][data-topic-name="${narrow_state.topic()}"] #toggle-camera`)?.addEventListener("click", () => {
                api.executeCommand('toggleVideo');
            });

            document.querySelector(`[data-stream-id="${narrow_state.stream_id()}"][data-topic-name="${narrow_state.topic()}"] #toggle-screen`)?.addEventListener("click", () => {
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

        // Скрываем лишние элементы
        $("#compose-content").hide();
        $("#bottom_whitespace").hide();
        $(".recipient_row").hide();

        // todo: добавить отловку ошибок внутри iframe
    } catch (error) {
        console.error("Error creating call:", error);
    }
}

export function exitAudioChannel() {
    // Отображаем элементы обратно при выходе из комнаты
    $("#compose-content").show();
    $("#bottom_whitespace").show();
    $(".recipient_row").show();
    const container = document.getElementById("audio-call-container");
    if (container) {
        container.innerHTML = '';
    }
    const controls = document.querySelector(`[data-stream-id="${narrow_state.stream_id()}"][data-topic-name="${narrow_state.topic()}"] #custom-controls`);
    if (controls) {
        controls.style.display = "none";
    }
    isInAudioChannel = false;
}

export function initialize(): void {
    // Настраиваем наблюдатель для отслеживания изменений в элементе с id="message-lists-container"
    const targetNode = document.getElementById("message-lists-container");
    if (targetNode) {
        const observer = new MutationObserver(() => {
            // Проверяем, находится ли пользователь в комнате с иконкой 🔊
            const topicName = narrow_state.topic();
            if (topicName && topicName.includes("🔊")) {
                if (!isInAudioChannel) {
                    isInAudioChannel = true;
                }
            } else {
                if (isInAudioChannel) {
                    isInAudioChannel = false;
                    callUrl = null;
                    exitAudioChannel();
                }
            }
        });
        observer.observe(targetNode, { childList: true, subtree: true });
    }
}
