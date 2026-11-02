export const PanelPosition = Object.freeze({
    LEFT: 'left',
    CENTER_LEFT: 'center-left',
    CENTER_RIGHT: 'center-right',
    RIGHT: 'right',
});

export function resolvePanelPosition(position) {
    switch (position) {
        case PanelPosition.CENTER_LEFT:
            return { box: 'center', index: 0 };
        case PanelPosition.CENTER_RIGHT:
            return { box: 'center', index: -1 };
        default:
            return { box: position, index: 0 };
    }
}