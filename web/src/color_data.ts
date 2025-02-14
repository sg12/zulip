import _ from "lodash";

export let unused_colors: string[];

// These colors are used now for streams.
const stream_colors = [
    "#a6c7e5",
];

// Shuffle our colors on page load to prevent
// bias toward "early" colors.
export const colors = _.shuffle(stream_colors);

export function reset(): void {
    unused_colors = [...colors];
}

reset();

export function claim_color(color: string): void {
    const i = unused_colors.indexOf(color);

    if (i === -1) {
        return;
    }

    unused_colors.splice(i, 1);

    if (unused_colors.length === 0) {
        reset();
    }
}

export function claim_colors(subs: {color: string}[]): void {
    const colors = new Set(subs.map((sub) => sub.color));
    for (const color of colors) {
        claim_color(color);
    }
}

export function pick_color(): string {
    const color = unused_colors[0]!;

    claim_color(color);

    return color;
}
