import $ from "jquery";
import * as compose_call_ui from "./compose_call_ui.ts";
import * as narrow_state from "./narrow_state.ts";

let callUrl: string | null = null;
let isInAudioChannel = false;

function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Извлекаем последнюю ссылку на видеозвонок из чата
function searchForLink() {
    const messageLinks = $(".message_content a").get().reverse(); // Перебираем элементы в обратном порядке
    console.log("messageLinks", messageLinks);
    for (const link of messageLinks) {
        const href = $(link).attr("href");
        // todo: заменить на bbb
        if (href && href.includes("meet.jit.si")) {
            callUrl = href;
            break; // Прерываем цикл, если нашли ссылку
        }
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

            // Генерируем и вставляем новую ссылку на видеозвонок в чат
            compose_call_ui.generate_and_insert_audio_or_video_call_link($(".video_link"), false)

            $("#compose-send-button").click(); // Отправляем сообщение с ссылкой

            // Извлекаем ссылку из отправленного сообщения
            searchForLink();
        }

        // Получаем максимальную высоту окна браузера и ставим 75 процентов
        const maxHeight = window.innerHeight;
        const iframeHeight = Math.floor(maxHeight * 0.75);

        // Вставляем ссылку в iframe с динамической высотой
        container.innerHTML = '<iframe id="audio-call-iframe" src="' + callUrl + '" width="100%" height="' + iframeHeight + 'px" frameborder="0" allow="microphone *; camera *; display-capture *;" allowfullscreen style="box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);"></iframe>';

        // Скрываем лишние элементы
        $("#compose-content").hide();
        $("#bottom_whitespace").hide();
        $(".recipient_row").hide();

        // todo: добавить отловку ошибок внутри iframe из bbb
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
}

export function initialize(): void {
    // Настраиваем наблюдатель для отслеживания изменений в элементе с id="message-lists-container"
    const targetNode = document.getElementById("message-lists-container");
    if (targetNode) {
        const observer = new MutationObserver(() => {
            // Проверяем, находится ли пользователь в теме с иконкой 🔊
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
