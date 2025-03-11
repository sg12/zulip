import $ from "jquery";
import * as compose_call from "./compose_call.ts";
import { current_user } from "./state_data.ts";
import * as narrow_state from "./narrow_state.ts";
import { SignJWT } from 'jose';
import { media_breakpoints_num } from "./css_variables.ts";


let api: any = null;
let isMicMuted = true;
let isCameraMuted = true;
let isScreenSharing = false;
let url_video = "";
let topicNameVideo = "";
let streamNameVideo = "";
let videoContainer: HTMLElement;
let currentVideoCallRoom: { streamId: string | number, topicName: string | number } | null = null;
// let isFloatingVideo = false;
export let CURRENT_TOPIC_CHARNAME: string = "";

const JITSI_DOMAIN = "connect-rm-video.ru:8443";
// const JITSI_DOMAIN = "jitsi-connectrm.ru:8443";

function updateMicIcon() {
    // @ts-ignore
    const micIcon = document.querySelector(`[data-stream-id="${currentVideoCallRoom.streamId}"][data-topic-name="${currentVideoCallRoom.topicName}"] #toggle-mic`);
    if (micIcon) {
        micIcon.className = isMicMuted ? "zulip-icon zulip-icon-mic-off" : "zulip-icon zulip-icon-mic-on";
    }
}

function updateCameraIcon() {
    // @ts-ignore
    const cameraIcon = document.querySelector(`[data-stream-id="${currentVideoCallRoom.streamId}"][data-topic-name="${currentVideoCallRoom.topicName}"] #toggle-camera`);
    if (cameraIcon) {
        cameraIcon.className = isCameraMuted ? "zulip-icon zulip-icon-camera-off" : "zulip-icon zulip-icon-camera-on";
    }
}

function updateScreenIcon() {
    // @ts-ignore
    const screenButton = document.querySelector(`[data-stream-id="${currentVideoCallRoom.streamId}"][data-topic-name="${currentVideoCallRoom.topicName}"] #toggle-screen`);
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

export function insert_audio_call_url(url: string, topic_name: string, stream_name: string): void {
    url_video = url;
    topicNameVideo = topic_name;
    streamNameVideo = stream_name;

    // Сохраняем информацию о текущей комнате с видеозвонком
    currentVideoCallRoom = {
        streamId: narrow_state.stream_id() ?? "",
        topicName: narrow_state.topic() ?? ""
    };

    // Инициализируем контейнер для видео
    if (!videoContainer) initVideoContainer();
    if (!videoContainer) return;

    const $middleColumn = $(".app-main .column-middle");
    if (isNarrowScreen()) {
        console.log("Мобильный режим!");
        $middleColumn.hide();
    } else {
        $middleColumn.show();
    }

    updateVideoFramePosition();

    const videoStaticContainer = document.getElementById("video-container");
    if (videoStaticContainer) showLoadBar(videoStaticContainer);

    videoContainer.innerHTML = "";
    const topicLabel = document.getElementById("video-room-overlay");
    if (topicLabel) topicLabel.remove();

    const cleanUrl = url.split('#')[0];
    const roomName = encodeURIComponent(cleanUrl.split('/').pop()?.split('?')[0] || "");

    // Генерация токена с использованием .then()
    generateToken().then((jwt) => {
        console.log("----jwt: " + jwt);  // Логируем токен

        const options = {
            roomName: roomName,
            parentNode: videoContainer,
            jwt: jwt,
            configOverwrite: {
                prejoinConfig: { enabled: false },
                disableSimulcast: true,
                startWithVideoMuted: true,
                startWithAudioMuted: false,
                disableAudioLevels: false,
                stereo: false,
                echoCancellation: true,
                noiseSuppression: true,
                highpassFilter: true,
                autoGainControl: true,
                enableLipSync: false,
                audioProcessing: {
                    autoGainControl: true,
                    echoCancellation: true,
                    noiseSuppression: true,
                    highpassFilter: true
                }
            },
            interfaceConfigOverwrite: {
                DISABLE_VIDEO_BACKGROUND: true,
                DISABLE_DOMINANT_SPEAKER_INDICATOR: true,
                TOOLBAR_BUTTONS: [
                    'camera',
                    'desktop',
                    'microphone',
                    'settings',
                    'fullscreen',
                    'hangup'
                ]
            },
            userInfo: {
                displayName: current_user.full_name,
                email: current_user.email,
            },
        };

        console.log('Jitsi Options:', JSON.stringify(options, null, 2));  // Логируем объект с отступами для удобства чтения

        api = new JitsiMeetExternalAPI(JITSI_DOMAIN, options);

        CURRENT_TOPIC_CHARNAME = topicNameToChar(topicNameVideo);

        const columnMiddle = document.getElementById("video-container");
        const resizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(updateVideoFramePosition);
        });

        if (columnMiddle) resizeObserver.observe(columnMiddle);

        addListenersVideo();

        const iframe = document.querySelector('iframe');
        if (iframe) {
            iframe.style.display = "none";
            iframe.addEventListener('load', () => {
                setTimeout(() => {
                    const iframe = videoContainer.querySelector("iframe") as HTMLIFrameElement;
                    if (iframe) {
                        removeLoadBar();
                        iframe.style.display = "block";
                        addRoomNameOverlay(streamNameVideo + ` > ` + topicNameVideo);
                    }
                }, 10);
            });
        }
    }).catch((error) => {
        console.error('Error generating token:', error);
    });
}



export function insert_audio_call_url_old(url: string, topic_name: string): void {
    url_video = url;
    topicNameVideo = topic_name;
    // let videoContainer = document.getElementById("floating-video-container");
    if (!videoContainer) initVideoContainer();
    if (!videoContainer) return;
    const $middleColumn = $(".app-main .column-middle");
    if (isNarrowScreen()) {
        console.log("Мобильный режим!");
        $middleColumn.hide();
    } else {
        $middleColumn.show();
    }

    updateVideoFramePosition();

    const videoStaticContainer = document.getElementById("video-container");
    if (videoStaticContainer)
        showLoadBar(videoStaticContainer);


    // console.log("-------videoContainer.style.left: " + videoContainer.style.left);
    videoContainer.innerHTML = "";
    const topicLabel = document.getElementById("video-room-overlay");
    if (topicLabel) topicLabel.remove();

    const cleanUrl = url.split('#')[0];
    // // Вставляем ссылку в iframe с использованием Jitsi Meet API
    const roomName = encodeURIComponent(cleanUrl.split('/').pop()?.split('?')[0] || ""); // Кодируем имя комнаты
    // const jwt = encodeURIComponent(cleanUrl.split('jwt=')[1] || ""); // Кодируем JWT
    const jwt = generateToken();
    console.log("----jwt: " + jwt);
    const options = {
        roomName: roomName,
        parentNode: videoContainer,
        jwt: jwt,
        configOverwrite: {
            prejoinConfig: { enabled: false },
            disableSimulcast: true, // Отключаем многопоточное видео (важно для стабильности)
            startWithVideoMuted: true,  // Отключаем видео по умолчанию (экономия трафика)
            startWithAudioMuted: false, // Включаем звук сразу
            disableAudioLevels: false,  // Оставляем индикатор громкости
            stereo: false, // Отключаем стерео (экономия трафика)
            enableLipSync: false // Отключаем синхронизацию губ (не нужно при низком качестве)
        },
        interfaceConfigOverwrite: {
            DISABLE_VIDEO_BACKGROUND: true, // Отключаем размытие фона (экономия CPU)
            DISABLE_DOMINANT_SPEAKER_INDICATOR: true, // Отключаем индикатор активного говорящего
            SHOW_POWERED_BY: false, // Убираем "Powered by Jitsi"
            SHOW_BRAND_WATERMARK: false, // Убираем логотип Jitsi
            SHOW_WATERMARK_FOR_GUESTS: false, // Убираем логотип для гостей
            TOOLBAR_BUTTONS: [
                'camera',
                'desktop',
                'microphone',
                'settings',
                'fullscreen',
                'hangup'
            ]
        },
        userInfo: {
            displayName: current_user.full_name,
            email: current_user.email,
        },

    };
    console.log('Jitsi Options:', JSON.stringify(options, null, 2));  // Логируем объект с отступами для удобства чтения

    api = new JitsiMeetExternalAPI(JITSI_DOMAIN, options);

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
                    addRoomNameOverlay(streamNameVideo + ` > ` + topicNameVideo);
                    // handleOverlayMouseEvents(videoContainer, overlay, iframe);
                    // logAbsolutePositions();
                }
            }, 10);
        });
    }

}

export function insert_audio_call_url_new(url: string, topic_name: string, stream_name: string): void {
    url_video = url;
    topicNameVideo = topic_name;
    streamNameVideo = stream_name;

    // Сначала запрашиваем разрешения
    requestPermissions().then(() => {
        console.log("Все необходимые разрешения получены.");
        startConference(url, topic_name, stream_name);
    }).catch((error) => {
        console.error("Ошибка при получении разрешений: ", error);
    });
}

async function requestPermissions(): Promise<void> {
    try {
        console.log("Запрос разрешений на использование камеры и микрофона...");
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        stream.getTracks().forEach(track => track.stop()); // Остановка стрима после проверки
        console.log("Разрешение на камеру и микрофон получено.");

        console.log("Запрос разрешения на демонстрацию экрана...");
        await navigator.mediaDevices.getDisplayMedia({ video: true });
        console.log("Разрешение на демонстрацию экрана получено.");
    } catch (error) {
        throw new Error("Пользователь отклонил запрос на доступ к камере или экрану.");
    }
}

function startConference(url: string, topic_name: string, stream_name: string): void {
    // Инициализируем контейнер для видео
    if (!videoContainer) initVideoContainer();
    if (!videoContainer) return;

    const $middleColumn = $(".app-main .column-middle");
    if (isNarrowScreen()) {
        console.log("Мобильный режим!");
        $middleColumn.hide();
    } else {
        $middleColumn.show();
    }

    updateVideoFramePosition();

    const videoStaticContainer = document.getElementById("video-container");
    if (videoStaticContainer) showLoadBar(videoStaticContainer);

    videoContainer.innerHTML = "";
    const topicLabel = document.getElementById("video-room-overlay");
    if (topicLabel) topicLabel.remove();

    const cleanUrl = url.split('#')[0];
    const roomName = encodeURIComponent(cleanUrl.split('/').pop()?.split('?')[0] || "");

    // Генерация токена с использованием .then()
    generateToken().then((jwt) => {
        console.log("----jwt: " + jwt);  // Логируем токен

        const options = {
            roomName: roomName,
            parentNode: videoContainer,
            jwt: jwt,
            configOverwrite: {
                prejoinConfig: { enabled: false },
                disableSimulcast: true,
                startWithVideoMuted: true,
                startWithAudioMuted: false,
                disableAudioLevels: false,
                stereo: false,
                enableLipSync: false
            },
            interfaceConfigOverwrite: {
                DISABLE_VIDEO_BACKGROUND: true,
                DISABLE_DOMINANT_SPEAKER_INDICATOR: true,
                TOOLBAR_BUTTONS: [
                    'camera',
                    'desktop',
                    'microphone',
                    'settings',
                    'fullscreen',
                    'hangup'
                ]
            },
            userInfo: {
                displayName: current_user.full_name,
                email: current_user.email,
            },
        };

        console.log('Jitsi Options:', JSON.stringify(options, null, 2));  // Логируем объект с отступами для удобства чтения

        api = new JitsiMeetExternalAPI(JITSI_DOMAIN, options);

        CURRENT_TOPIC_CHARNAME = topicNameToChar(topicNameVideo);

        const columnMiddle = document.getElementById("video-container");
        const resizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(updateVideoFramePosition);
        });

        if (columnMiddle) resizeObserver.observe(columnMiddle);

        addListenersVideo();

        const iframe = document.querySelector('iframe');
        if (iframe) {
            iframe.style.display = "none";
            iframe.addEventListener('load', () => {
                setTimeout(() => {
                    const iframe = videoContainer.querySelector("iframe") as HTMLIFrameElement;
                    if (iframe) {
                        removeLoadBar();
                        iframe.style.display = "block";
                        addRoomNameOverlay(streamNameVideo + ` > ` + topicNameVideo);
                    }
                }, 10);
            });
        }
    }).catch((error) => {
        console.error('Error generating token:', error);
    });
}


function addListenersVideo() {
    api.addListener('videoConferenceJoined', () => {
        const controls = document.querySelector(`[data-stream-id="${narrow_state.stream_id()}"][data-topic-name="${narrow_state.topic()}"] #custom-controls`);
        if (controls) {
            controls.style.display = "flex";
        }

        // Обработчики событий для кнопок
        document.querySelector(`[data-stream-id="${narrow_state.stream_id()}"][data-topic-name="${narrow_state.topic()}"] #toggle-mic`)?.addEventListener("click", () => {toggleMicHandler});

        document.querySelector(`[data-stream-id="${narrow_state.stream_id()}"][data-topic-name="${narrow_state.topic()}"] #toggle-camera`)?.addEventListener("click", () => {toggleCameraHandler});

        document.querySelector(`[data-stream-id="${narrow_state.stream_id()}"][data-topic-name="${narrow_state.topic()}"] #toggle-screen`)?.addEventListener("click", () => {toggleScreenHandler});

        const currentParticipants = api.getParticipantsInfo();
        console.log("Список участников при присоединении:", currentParticipants);

        currentParticipants.forEach((participant) => {
            addUserToCall({
                id: participant.participantId,
                name: participant.displayName || "Аноним",
                isMuted: participant.muted || false,
                volume: 100,
                hovered: false,
            })
        })
        removeLoadBar();
        videoContainer.style.display = "block";
        setTimeout(() => {
            api.executeCommand('setNoiseSuppressionEnabled', {
                enabled: true
            });
            console.log('Noise suppression enabled after joining conference');
        }, 1000); // Задержка 1 секунда после присоединения
    });

    api.addListener('participantLeft', (participantId: string) => {
        removeUserFromCall(participantId)
    })

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
            const topicLabel = document.getElementById("video-room-overlay");
            if (topicLabel) topicLabel.remove();
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
        videoContainer.style.zIndex = "1";
        videoContainer.style.position = "fixed";
        // videoContainer.style.background = "rgba(0, 0, 0, 0.1)";
        // videoContainer.style.borderRadius = "10px";
        // videoContainer.style.boxShadow = "0px 4px 10px rgba(0, 0, 0, 0.05)";
        // isFloatingVideo = false;
    }
}

function updateVideoFramePosition() {
    if (!videoContainer)
        return;
    // if (!isFloatingVideo) {
    let columnMiddle = document.getElementById("column-middle-container");
    let columnMiddlePosition = getAbsolutePosition(columnMiddle, "column-middle-container");
    const rightSidebar = document.getElementById("right-sidebar-container");
    const rightSidebarPosition = getAbsolutePosition(rightSidebar, "right-sidebar-container");
    let rightSidebarX = rightSidebarPosition?.x;
    let rightSidebarWidth = rightSidebarPosition?.width;
    if (columnMiddlePosition?.width == 0) {
        columnMiddle = document.getElementById("left-sidebar-container");
        columnMiddlePosition = getAbsolutePosition(columnMiddle, "left-sidebar-container");
        rightSidebarX = window.innerWidth;
        rightSidebarWidth = 0;
    }

    const settingsContent = document.getElementById("settings_content");
    const settingsContentPosition = getAbsolutePosition(settingsContent, "settings_conten");
    const iframeLeft = columnMiddlePosition?.x + columnMiddlePosition?.width;
    const iframeTop = columnMiddlePosition?.y + settingsContentPosition?.y - window.scrollY;
    // const iframeTop = settingsContentPosition?.y - window.scrollY;

    let iframeWidth = (rightSidebarX - iframeLeft);
    // if (iframeWidth >= window.innerWidth * 0.33)
    //     iframeWidth = window.innerWidth * 0.33;
    if (rightSidebarWidth == 0 && columnMiddlePosition?.width == 0)
        iframeWidth = window.innerWidth * 0.95;
    else if (rightSidebarWidth == 0 && columnMiddlePosition?.width > 0)
        iframeWidth = window.innerWidth * 0.45;
    const iframeHeight = window.innerHeight * 75 / 100;
    videoContainer.style.left = `${iframeLeft + 5}px`;
    videoContainer.style.width = `${iframeWidth}px`;
    videoContainer.style.top = `${iframeTop + 12 + 16}px`;
    videoContainer.style.height = `${iframeHeight}px`;
    console.log("---videoContainer.style.left:", videoContainer.style.left);
    // } else {
    //     // videoContainer.style.removeProperty("top");
    //     // videoContainer.style.removeProperty("left");
    //     videoContainer.style.width = "320px";
    //     videoContainer.style.height = "160px";
    //     videoContainer.style.bottom = "20px";
    //     videoContainer.style.right = "20px";
    // }
}

function addRoomNameOverlay(roomName: string) {
    if (!videoContainer) return;

    // Проверяем, существует ли уже панель
    let overlay = document.getElementById("video-room-overlay");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "video-room-overlay";
        overlay.style.position = "fixed";
        overlay.style.background = "rgba(255, 255, 255, 0.6)"; // Белая полупрозрачная панель
        overlay.style.height = "16px";
        overlay.style.display = "flex";
        overlay.style.alignItems = "center";
        overlay.style.justifyContent = "center";
        overlay.style.fontSize = "16px";
        overlay.style.fontWeight = "bold";
        overlay.style.color = "#333";
        overlay.style.zIndex = "2"; // Выше видео
        overlay.style.borderBottom = "1px solid rgba(0, 0, 0, 0.1)";

        document.body.appendChild(overlay);
    }

    // Обновляем текст
    overlay.textContent = `Комната: ${roomName}`;

    // Вычисляем и обновляем позицию
    function updateOverlayPosition() {
        if (!videoContainer) return;

        const rect = videoContainer.getBoundingClientRect();
        overlay.style.left = `${rect.left}px`;
        //overlay.style.top = `${rect.top}px`;
        overlay.style.top = `${rect.top - 16}px`;
        overlay.style.width = `${rect.width}px`;
    }

    updateOverlayPosition();
    window.addEventListener("resize", updateOverlayPosition);
}

export function topicNameToChar(topicName: string): string {
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
    // isFloatingVideo = true;
    updateVideoFramePosition();
}

export function clickStream() {
    if (currentVideoCallRoom && currentVideoCallRoom.streamId === narrow_state.stream_id()) {
        updateButtonHandlers();
    }
}

export function clickLeftSidebar(isSameTopic: boolean) {
    const $middleColumn = $(".app-main .column-middle");

    // if ($middleColumn.is(":visible")) {
    //     $middleColumn.hide();
    // } else {
    $middleColumn.show();
    // }
    clearButtonsAndPropsForVideo();
    if (!isShowingVideo()) {
        //     if (isSameTopic) return; // if the same topic, but have no video, so need sho buttons
        //     clearButtonsAndPropsForVideo();
        //     return;
        const topicLabel = document.getElementById("video-room-overlay");
        if (topicLabel) topicLabel.remove();
    }

    const currentTopicName = narrow_state.topic();
    if (currentVideoCallRoom && currentVideoCallRoom.streamId === narrow_state.stream_id()) {
        if (currentTopicName?.startsWith("🔊")) {
            if (currentTopicName === currentVideoCallRoom.topicName) updateButtonHandlers();
            else updateButtonHandlers(true);
        } else if (currentTopicName?.startsWith("✏️")) {
            //  Не удаляем customControls, если комната является текстовой
            updateButtonHandlers();
        }
    }
    // if (!isSameTopic && !isFloatingVideo)
    // moveVideoToCorner();
    // else if (isSameTopic && isFloatingVideo)
    // restoreVideoPosition();
}

export function isShowingVideo(): boolean {
    if (videoContainer && videoContainer.querySelector("iframe"))
        return true;
    else
        return false;
}

function updateButtonHandlers(force: boolean = false) {
    if (!currentVideoCallRoom) return;

    if (force) {
        // Скрываем предыдущие кнопки, если они существуют
        const controls = document.querySelector(`[data-stream-id="${currentVideoCallRoom.streamId}"][data-topic-name="${currentVideoCallRoom.topicName}"] #custom-controls`);
        if (controls) {
            controls.style.display = "none";
        }
    }

    if (!force) {
        const controls = document.querySelector(`[data-stream-id="${currentVideoCallRoom.streamId}"][data-topic-name="${currentVideoCallRoom.topicName}"] #custom-controls`);
        if (controls) {
            controls.style.display = "flex";
        }
    }


	// Добавляем кнопку настроек-шестерёнки в header
    const spectatorButtons = document.querySelector('.spectator_login_buttons');
    // if (spectatorButtons) {
    //     // Проверяем, нет ли уже кнопки настроек
    //     let settingsButton = document.querySelector('#settings-toggle-button') as HTMLElement;
    //     if (!settingsButton) {
    //         settingsButton = document.createElement('div');
    //         settingsButton.id = 'settings-toggle-button';
    //         settingsButton.className = 'header-button navbar-item';
    //         settingsButton.setAttribute('role', 'button');
    //         settingsButton.setAttribute('tabindex', '0');
    //         settingsButton.innerHTML = '<i class="zulip-icon zulip-icon-settings"></i>';
    //         spectatorButtons.appendChild(settingsButton);

    //         // Добавляем обработчик
    //         settingsButton.addEventListener('click', toggleSettingsHandler);
    //     }
    // }

    // Удаляем старые обработчики событий для кнопок
    const micButton = document.querySelector(`[data-stream-id="${currentVideoCallRoom.streamId}"][data-topic-name="${currentVideoCallRoom.topicName}"] #toggle-mic`);
    const cameraButton = document.querySelector(`[data-stream-id="${currentVideoCallRoom.streamId}"][data-topic-name="${currentVideoCallRoom.topicName}"] #toggle-camera`);
    const screenButton = document.querySelector(`[data-stream-id="${currentVideoCallRoom.streamId}"][data-topic-name="${currentVideoCallRoom.topicName}"] #toggle-screen`);

    if (micButton) {
        micButton.removeEventListener("click", toggleMicHandler);
    }
    if (cameraButton) {
        cameraButton.removeEventListener("click", toggleCameraHandler);
    }
    if (screenButton) {
        screenButton.removeEventListener("click", toggleScreenHandler);
    }

    // Добавляем новые обработчики событий для кнопок
    if (micButton) {
        micButton.addEventListener("click", toggleMicHandler);
    }
    if (cameraButton) {
        cameraButton.addEventListener("click", toggleCameraHandler);
    }
    if (screenButton) {
        screenButton.addEventListener("click", toggleScreenHandler);
    }

    api.isAudioMuted().then((muted: boolean) => {
        isMicMuted = muted;
        updateMicIcon();
    });

    api.isVideoMuted().then((muted: boolean) => {
        isCameraMuted = muted;
        updateCameraIcon();
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
}

function toggleMicHandler(e: Event) {
    e.preventDefault();
    e.stopPropagation();
    api.executeCommand('toggleAudio');
}

function toggleCameraHandler(e: Event) {
    e.preventDefault();
    e.stopPropagation();
    api.executeCommand('toggleVideo');
}

function toggleScreenHandler(e: Event) {
    e.preventDefault();
    e.stopPropagation();
    api.executeCommand('toggleShareScreen');
}

function toggleAudio(participantId: string) {
    let participants = JSON.parse(localStorage.getItem("callUsers"));
    const participant = participants[participantId];

    if (participant) {
        participants[participantId].isMuted = !participant.participantId.isMuted;
        api.executeCommand('setParticipantVolume', participant.id,  participant.isMuted ? 0 : participant.volume/100);
        localStorage.setItem("callUsers", JSON.stringify(participants))
    }
};

function changeVolume(participantId: string, volume: number) {
    let participants = JSON.parse(localStorage.getItem("callUsers"));
    const participant = participants[participantId];
    if (participant) {
        api.executeCommand('setParticipantVolume', participant.id, volume / 100);
        participant.participantId.volume = volume;
        localStorage.setItem("callUsers", JSON.stringify(participants));
    }
};

function addUserToCall(participant: JSON) {
    let participants = JSON.parse(localStorage.getItem("callUsers")) || {};
    participants[participant.id] = participant;
    localStorage.setItem("callUsers", JSON.stringify(participants));
}

function removeUserFromCall(participantId: string) {
    let participants = JSON.parse(localStorage.getItem("callUsers")) || {};
    delete participants[participantId];
    localStorage.setItem("callUsers", JSON.stringify(participants));
}

function clearButtonsAndPropsForVideo() {
    const enterButton = document.getElementById("enter-button");
    if (enterButton) enterButton.remove();
    // const topicLabel = document.getElementById("video-room-overlay");
    // if (topicLabel) topicLabel.remove();
    removeLoadBar();

	// удиление кнопки настроек-шестерёнки
	const settingsButton = document.querySelector('#settings-toggle-button');
    if (settingsButton) settingsButton.remove();
}

function showLoadBar(loadContainer: HTMLElement) {
    const loadingBar = document.createElement("div");
    loadingBar.id = "loading-spinner";
    // const rect = loadContainer?.getBoundingClientRect();
    // if (rect) {
    //     loadingBar.style.left = `${rect.left + rect.width / 2 - 50}px`; // Отступ справа
    //     loadingBar.style.top = `${200}px`; // Отступ сверху
    // }
    const left = parseFloat(videoContainer.style.left) || 0;
    const width = parseFloat(videoContainer.style.width) || 0;
    loadingBar.style.left = `${left + width / 2 - 50}px`; // Отступ справа
    loadingBar.style.top = `${200}px`; // Отступ сверху
    console.log("---- 55: " + loadingBar.style.left);
    // loadContainer?.appendChild(loadingBar);
    document.body.appendChild(loadingBar);
}

function removeLoadBar() {
    const loadingBar = document.getElementById("loading-spinner");
    if (loadingBar)
        loadingBar.remove();
}

function addSettingsButton() {
    const settingsButton = document.createElement("div");
    settingsButton.id = 'settings-toggle-button';
    settingsButton.className = 'header-button navbar-item';
    settingsButton.setAttribute('role', 'button');
    settingsButton.setAttribute('tabindex', '0');
    settingsButton.innerHTML = '<i class="zulip-icon zulip-icon-settings"></i>';

    // Стили для кнопки
    settingsButton.style.display = 'flex';
    settingsButton.style.alignItems = 'center';
    settingsButton.style.justifyContent = 'center';
    settingsButton.style.width = '30px';
    settingsButton.style.height = '30px';
    settingsButton.style.cursor = 'pointer';

    // Стили для иконки
    const icon = settingsButton.querySelector('i');
    if (icon) {
        icon.style.width = '20px';
        icon.style.height = '20px';
        icon.style.backgroundImage = "url('/images/icons/settings.svg')";
        icon.style.backgroundSize = 'contain';
        icon.style.backgroundRepeat = 'no-repeat';
        icon.style.backgroundPosition = 'center';
    }

    // Добавляем кнопку в spectator_login_buttons
    const spectatorButtons = document.querySelector('.spectator_login_buttons');
    if (spectatorButtons && !document.querySelector('#settings-toggle-button')) {
        spectatorButtons.appendChild(settingsButton);
    }

    // Обработчик для открытия настроек
    settingsButton.addEventListener("click", () => {
        if (api) {
            api.executeCommand('displaySettings');
        } else {
            console.error('Jitsi API не инициализирован');
        }
    });

    // Hover-эффект
    settingsButton.addEventListener('mouseover', () => {
        settingsButton.style.backgroundColor = 'rgba(0, 0, 0, 0.1)';
        settingsButton.style.borderRadius = '5px';
    });
    settingsButton.addEventListener('mouseout', () => {
        settingsButton.style.backgroundColor = '';
    });
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
        // if (isFloatingVideo) restoreVideoPosition();
        // else moveVideoToCorner();
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
        const topicLabel = document.getElementById("video-room-overlay");
        if (topicLabel) topicLabel.remove();
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
    const topicLabel = document.getElementById("video-room-overlay");
    if (topicLabel) topicLabel.remove();

    addRoomNameOverlay(streamNameVideo + ` > ` + topicNameVideo);

    updateVideoFramePosition();

    const container = document.getElementById("floating-video-container");
    if (!container) return;

    // Удаляем старую кнопку и надпись, если они есть
    const existingButton = document.getElementById("enter-button");
    if (existingButton) existingButton.remove();
    const existingLabel = document.getElementById("topic-label");
    if (existingLabel) existingLabel.remove();

    // Создаем надпись с темой
    // const topicLabel = document.createElement("div");
    // topicLabel.innerText = topicNameVideo;
    // topicLabel.style.position = "fixed";
    // topicLabel.style.fontSize = "18px";
    // topicLabel.style.fontWeight = "bold";
    // topicLabel.style.color = "black";
    // topicLabel.style.zIndex = "10001";
    // topicLabel.id = "topic-label";

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
    enterButton.style.zIndex = "5";
    enterButton.id = "enter-button";

    // Добавляем элементы в body
    // document.body.appendChild(topicLabel);
    document.body.appendChild(enterButton);

    // Функция обновления позиции
    function updatePositions() {
        if (!videoContainer) return;
        const rect = videoContainer.getBoundingClientRect();
        enterButton.style.left = `${rect.left + rect.width / 2 - 60}px`;
        enterButton.style.top = `${150}px`;
        // topicLabel.style.left = `${rect.left + rect.width / 2 - topicLabel.offsetWidth / 2}px`;
        // topicLabel.style.top = `${120}px`;
    }

    updatePositions();
    window.addEventListener("resize", updatePositions);

    enterButton.addEventListener("click", () => {
        document.body.removeChild(enterButton);
        // document.body.removeChild(topicLabel);
        insert_audio_call_url(url, topicNameVideo, streamNameVideo);
    });
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

export function update_video_position() {
    updateVideoFramePosition();
    const topicLabel = document.getElementById("video-room-overlay");
    if (topicLabel) topicLabel.remove();
    addRoomNameOverlay(streamNameVideo + ` > ` + topicNameVideo);
}

function isNarrowScreen(): boolean {
    console.log("Мобильный режим - 1: " + media_breakpoints_num.lg + " - " + window.innerWidth);
    return window.innerWidth < media_breakpoints_num.lg;
}
