import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { file, test, eq, ok, report } from './harness.mjs';
import { PanelPosition, resolvePanelPosition } from '../panel-position.js';

file('panel');

const root = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
const [success, bytes] = root.get_child('extension.js').load_contents(null);
ok(success, 'entry point is readable');
const source = new TextDecoder().decode(bytes);
const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
    root.get_child('schemas').get_path(), Gio.SettingsSchemaSource.get_default(), false);
const schema = schemaSource.lookup('org.gnome.shell.extensions.weatherglass', false);
const key = schema.get_key('panel-position');

test('panel schema choices match the immutable shared enum', () => {
    eq(key.get_default_value().deep_unpack(), 'right');
    eq(JSON.stringify(key.get_range().deep_unpack()[1].deep_unpack()),
        JSON.stringify(Object.values(PanelPosition)));
    ok(Object.isFrozen(PanelPosition), 'immutable enum');
    for (const position of Object.values(PanelPosition))
        ok(key.range_check(new GLib.Variant('s', position)), position);
    ok(!key.range_check(new GLib.Variant('s', 'bottom')), 'invalid position rejected');
});

const boxes = Object.fromEntries(['left', 'center', 'right'].map(position => {
    const box = {
        children: [],
        remove_child(container) {
            this.children.splice(this.children.indexOf(container), 1);
        },
        insert_child_at_index(container, index) {
            this.children.splice(index < 0 ? this.children.length : index, 0, container);
            container.parent = this;
        },
    };
    return [`_${position}Box`, box];
}));
let selected = 'right';
let registrations = 0;
const panel = {
    ...boxes,
    addToStatusArea(uuid, indicator, index, position) {
        registrations++;
        eq(uuid, 'test');
        this[`_${position}Box`].insert_child_at_index(indicator.container, index);
    },
};
class BaseExtension {
    getSettings() {
        return {
            get_string: name => {
                eq(name, 'panel-position');
                return selected;
            }
        };
    }
}
class Indicator {
    constructor() {
        this.container = {
            get_parent() { return this.parent; },
        };
    }
}
const theme = { load_stylesheet() { } };
const Entry = new Function('Extension', 'WeatherIndicator', 'Main', 'St', 'global', 'resolvePanelPosition',
    source.slice(source.indexOf('export default class')).replace('export default ', 'return '))(
        BaseExtension, Indicator, { panel },
        { ThemeContext: { get_for_stage: () => ({ get_theme: () => theme }) } },
        { stage: {} }, resolvePanelPosition);

test('enable honors the saved position; live moves keep one registered indicator', () => {
    const calendar = { name: 'calendar' };
    boxes._centerBox.children.push(calendar);
    const check = (position, indicator) => {
        const boxName = position.startsWith('center') ? 'center' : position;
        ok(indicator.container.get_parent() === boxes[`_${boxName}Box`], `uses ${boxName}`);
        if (boxName === 'center') {
            eq(boxes._centerBox.children.length, 2);
            ok(boxes._centerBox.children[position === PanelPosition.CENTER_RIGHT ? 1 : 0] === indicator.container,
                `correct side for ${position}`);
        }
        eq(Object.values(boxes).flatMap(box => box.children).length, 2);
    };
    for (const initial of Object.values(PanelPosition)) {
        selected = initial;
        const extension = new Entry();
        extension.uuid = 'test';
        extension.dir = { get_path: () => 'test', get_child: () => 'stylesheet.css' };
        extension.enable();
        const indicator = extension._indicator;
        check(initial, indicator);
        const before = registrations;
        for (const position of [...Object.values(PanelPosition), PanelPosition.CENTER_RIGHT]) {
            selected = position;
            extension._syncPanelPosition();
            ok(extension._indicator === indicator, 'indicator is retained');
            check(position, indicator);
        }
        eq(registrations, before);
        indicator.container.get_parent().remove_child(indicator.container);
    }
    boxes._centerBox.children.pop();
});

test('center-left prepends and center-right appends without a balancing spacer', () => {
    for (const position of [PanelPosition.CENTER_LEFT, PanelPosition.CENTER_RIGHT]) {
        const { box, index } = resolvePanelPosition(position);
        eq(box, 'center');
        eq(index, position === PanelPosition.CENTER_RIGHT ? -1 : 0);
    }
});

test('the existing settings listener dispatches panel-position changes', () => {
    const handler = source.slice(source.indexOf('        _onSetting(key) {'),
        source.indexOf('        _previewScene() {'));
    const Handler = new Function(`return class { ${handler} }`)();
    const indicator = new Handler();
    let moved = 0;
    indicator._ext = { _syncPanelPosition() { moved++; } };
    indicator._onSetting('panel-position');
    eq(moved, 1);
});

report('panel');