// Boni desklet for Cinnamon. The Boni app renders each widget of this computer to
// ~/.cache/boni/desklet/slot-N.png (and refreshes it); this desklet only shows one of those pictures
// and reloads it when the file changes. A click opens the Boni app.
const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const Mainloop = imports.mainloop;
const Util = imports.misc.util;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Clutter = imports.gi.Clutter;
const Cogl = imports.gi.Cogl;
const St = imports.gi.St;

const DIR = GLib.get_user_cache_dir() + "/boni/desklet";
const CHECK_SECONDS = 15;

class BoniDesklet extends Desklet.Desklet {
    constructor(metadata, deskletId) {
        super(metadata, deskletId);
        this.slot = 1;
        this.zoom = 100;
        this.settings = new Settings.DeskletSettings(this, metadata.uuid, deskletId);
        this.settings.bind("slot", "slot", () => this._load());
        this.settings.bind("zoom", "zoom", () => this._load());
        this._mtime = -1;
        this._box = new St.Bin();
        this.setContent(this._box);
        this._load();
        this._timer = Mainloop.timeout_add_seconds(CHECK_SECONDS, () => {
            if (this._modified() !== this._mtime) this._load();
            return true;
        });
    }

    _path() {
        return DIR + "/slot-" + this.slot + ".png";
    }

    _modified() {
        try {
            const info = Gio.File.new_for_path(this._path()).query_info("time::modified", Gio.FileQueryInfoFlags.NONE, null);
            return info.get_attribute_uint64("time::modified");
        } catch (e) {
            return 0;
        }
    }

    _load() {
        this._mtime = this._modified();
        try {
            let pixbuf = GdkPixbuf.Pixbuf.new_from_file(this._path());
            // Pictures are rendered at 2x for sharpness.
            const scale = (this.zoom / 100) * global.ui_scale / 2;
            const w = Math.max(1, Math.round(pixbuf.get_width() * scale));
            const h = Math.max(1, Math.round(pixbuf.get_height() * scale));
            pixbuf = pixbuf.scale_simple(w, h, GdkPixbuf.InterpType.BILINEAR);
            const image = new Clutter.Image();
            image.set_data(pixbuf.get_pixels(),
                pixbuf.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888,
                w, h, pixbuf.get_rowstride());
            const actor = new Clutter.Actor({ width: w, height: h });
            actor.set_content(image);
            this._box.set_child(actor);
        } catch (e) {
            this._box.set_child(new St.Label({
                text: "Boni: widget " + this.slot + "\nAbre la app Boni (o anade widgets en Graficas)",
                style: "color: #f0efec; background-color: rgba(26,26,25,0.85); padding: 14px; border-radius: 12px;",
            }));
        }
    }

    on_desklet_clicked(event) {
        Util.spawnCommandLine(GLib.file_test("/opt/boni/bin/boni", GLib.FileTest.IS_EXECUTABLE) ? "/opt/boni/bin/boni" : "boni");
    }

    on_desklet_removed() {
        if (this._timer) Mainloop.source_remove(this._timer);
        this._timer = 0;
    }
}

function main(metadata, deskletId) {
    return new BoniDesklet(metadata, deskletId);
}
