import { $t } from "./i18n.ts";
import _ from "lodash";

import render_more_private_conversations from "../templates/more_pms.hbs";
import render_pm_list_item from "../templates/pm_list_item.hbs";
import render_pm_subheader from "../templates/pm_subheader.hbs";
import * as vdom from "./vdom.ts";

// TODO/typescript: Move this to pm_list_data
type PMListConversation = {
    user_ids_string: string;
};

export type PMNode =
    | {
          type: "conversation";
          conversation: PMListConversation;
      }
    | {
          type: "more_items";
          more_conversations_unread_count: number;
      }
    | {
          type: "subheader";
          subheader_name: string;
      };

const subheaderTranslations: { [key: string]: string } = {
    "Pinned": $t({ defaultMessage: "Pinned" }),
    "All": $t({ defaultMessage: "Another direct message" }),
};

export function keyed_pm_li(conversation: PMListConversation): vdom.Node<PMNode> {
    const render = (): string => render_pm_list_item(conversation);

    const eq = (other: PMNode): boolean =>
        other.type === "conversation" && _.isEqual(conversation, other.conversation);

    const key = conversation.user_ids_string;

    return {
        key,
        render,
        eq,
        type: "conversation",
        conversation,
    };
}

export function more_private_conversations_li(
    more_conversations_unread_count: number,
): vdom.Node<PMNode> {
    const render = (): string =>
        render_more_private_conversations({more_conversations_unread_count});

    // Used in vdom.js to check if an element has changed and needs to
    // be updated in the DOM.
    const eq = (other: PMNode): boolean =>
        other.type === "more_items" &&
        more_conversations_unread_count === other.more_conversations_unread_count;

    // This special key must be impossible as a user_ids_string.
    const key = "more_private_conversations";

    return {
        key,
        render,
        eq,
        type: "more_items",
        more_conversations_unread_count,
    };
}

export function pm_subheader(subheader_name: string): vdom.Node<PMNode> {
    const translated_subheader_name = subheaderTranslations[subheader_name] || subheader_name;
    const render = (): string => render_pm_subheader({ subheader_name: translated_subheader_name });

    const eq = (other: PMNode): boolean =>
        other.type === "subheader" && subheader_name === other.subheader_name;

    const key = `subheader-${subheader_name}`;

    return {
        key,
        render,
        eq,
        type: "subheader",
        subheader_name,
    };
}

export function pm_ul(nodes: vdom.Node<PMNode>[]): vdom.Tag<PMNode> {
    const attrs: [string, string][] = [
        ["class", "dm-list"],
        ["data-name", "private"],
    ];
    return vdom.ul({
        attrs,
        keyed_nodes: nodes,
    });
}
