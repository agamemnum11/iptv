/*!
 * My IPTV — приватний плагін для Lampa
 * ---------------------------------------------------------
 * НІЯКИХ сторонніх серверів. Плагін звертається лише до
 * PLAYLIST_URL та EPG_URL, які ви вказуєте нижче самі.
 * Код побудований на перевірених реальних методах Lampa API
 * (Lampa.Reguest, Lampa.Scroll, Lampa.Controller, Navigator),
 * а не на здогадках.
 *
 * Встановлення:
 *  1. Впишіть свої посилання нижче (PLAYLIST_URL / EPG_URL).
 *  2. Викладіть файл на GitHub і візьміть посилання через
 *     jsDelivr (щоб уникнути проблем з MIME-типом):
 *     https://cdn.jsdelivr.net/gh/ВАШ_НІК/ВАШ_РЕПО@main/my-iptv-plugin.js
 *  3. У Lampa: Налаштування -> Розширення -> вставити це посилання.
 *
 * Діагностика: Ctrl+Shift+I -> Console, шукайте рядки "[MyIPTV]".
 */

(function () {
    'use strict';

    try {
        // ==== ЗНАЧЕННЯ ЗА ЗАМОВЧУВАННЯМ (можна змінити прямо в Lampa кнопкою) ====
        var DEFAULT_PLAYLIST_URL = 'https://ilook.epg.one/9ASR8Z64BLT9DH/2';
        var DEFAULT_EPG_URL = '';
        // ==========================================================================

        function getPlaylistUrl() {
            return Lampa.Storage.get('my_iptv_playlist_url', DEFAULT_PLAYLIST_URL);
        }

        function getEpgUrl() {
            return Lampa.Storage.get('my_iptv_epg_url', DEFAULT_EPG_URL);
        }

        if (window.my_iptv_plugin_ready) return;
        window.my_iptv_plugin_ready = true;

        function log() {
            var a = Array.prototype.slice.call(arguments);
            a.unshift('[MyIPTV]');
            console.log.apply(console, a);
        }

        function escapeHtml(str) {
            if (!str) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }

        function parseM3U(text) {
            var lines = text.split(/\r?\n/);
            var channels = [];
            var current = null;

            for (var i = 0; i < lines.length; i++) {
                var line = lines[i].trim();
                if (!line) continue;

                if (line.indexOf('#EXTINF') === 0) {
                    current = { title: '', logo: '', group: 'Інше', tvgId: '', url: '' };

                    var m;
                    m = line.match(/,(.*)$/);
                    if (m) current.title = m[1].trim();
                    m = line.match(/tvg-logo="([^"]*)"/i);
                    if (m) current.logo = m[1];
                    m = line.match(/group-title="([^"]*)"/i);
                    if (m && m[1]) current.group = m[1];
                    m = line.match(/tvg-id="([^"]*)"/i);
                    if (m) current.tvgId = m[1];
                } else if (line.indexOf('#') !== 0 && current) {
                    current.url = line;
                    channels.push(current);
                    current = null;
                }
            }
            return channels;
        }

        function parseXmltvDate(s) {
            if (!s) return null;
            var m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/);
            if (!m) return null;
            var iso = m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6];
            iso += m[7] ? (m[7].substring(0, 3) + ':' + m[7].substring(3)) : 'Z';
            var d = new Date(iso);
            return isNaN(d.getTime()) ? null : d.getTime();
        }

        function parseXMLTV(xmlText) {
            var epg = {};
            try {
                var parser = new DOMParser();
                var doc = parser.parseFromString(xmlText, 'text/xml');
                var progs = doc.getElementsByTagName('programme');
                var now = Date.now();

                for (var i = 0; i < progs.length; i++) {
                    var p = progs[i];
                    var ch = p.getAttribute('channel');
                    var start = parseXmltvDate(p.getAttribute('start'));
                    var stop = parseXmltvDate(p.getAttribute('stop'));
                    if (!ch || !start || !stop) continue;
                    if (now < start || now > stop) continue;

                    var titleEl = p.getElementsByTagName('title')[0];
                    epg[ch] = { title: titleEl ? titleEl.textContent : '', start: start, stop: stop };
                }
            } catch (e) {
                log('EPG parse error', e);
            }
            return epg;
        }

        function fmtTime(ms) {
            var d = new Date(ms);
            var h = ('0' + d.getHours()).slice(-2);
            var mi = ('0' + d.getMinutes()).slice(-2);
            return h + ':' + mi;
        }

        function Component(object) {
            var _this_ref = this;
            var html = $('<div class="my-iptv" style="background:rgba(10,10,14,0.55);border-radius:0.8em;padding:0.2em;"></div>');
            var scroll = new Lampa.Scroll({ mask: true, over: true });
            var body = $('<div style="padding:1.5em;max-width:900px;background:rgba(0,0,0,0.35);border-radius:0.8em;"></div>');
            var last = false;
            var channels = [];
            var epg = {};
            var network = new Lampa.Reguest();

            this.create = function () {
                return this.render();
            };

            this.render = function () {
                scroll.append(body);
                html.append(scroll.render());
                return html;
            };

            this.start = function () {
                Lampa.Controller.add('content', {
                    toggle: function () {
                        Lampa.Controller.collectionSet(scroll.render());
                        Lampa.Controller.collectionFocus(last, scroll.render());
                    },
                    up: function () {
                        if (Navigator.canmove('up')) Navigator.move('up');
                        else Lampa.Controller.toggle('head');
                    },
                    down: function () {
                        if (Navigator.canmove('down')) Navigator.move('down');
                    },
                    left: function () {
                        if (Navigator.canmove('left')) Navigator.move('left');
                        else Lampa.Controller.toggle('menu');
                    },
                    right: function () {
                        if (Navigator.canmove('right')) Navigator.move('right');
                    },
                    back: function () {
                        Lampa.Activity.backward();
                    }
                });

                Lampa.Controller.toggle('content');

                if (!channels.length) this.load();
            };

            this.load = function () {
                var _this = this;
                var playlistUrl = getPlaylistUrl();
                var epgUrl = getEpgUrl();

                object.activity.loader(true);

                if (!playlistUrl) {
                    object.activity.loader(false);
                    this.renderSettingsOnly();
                    return;
                }

                network.timeout(15000);

                network.silent(playlistUrl, function (text) {
                    channels = parseM3U(text);

                    if (!channels.length) {
                        object.activity.loader(false);
                        Lampa.Noty.show('Плейлист порожній або невірний формат M3U');
                        _this.renderSettingsOnly();
                        return;
                    }

                    if (epgUrl) {
                        network.timeout(15000);
                        network.silent(epgUrl, function (xml) {
                            epg = parseXMLTV(xml);
                            _this.draw();
                        }, function (e) {
                            log('EPG load error:', e);
                            _this.draw();
                        }, false, { dataType: 'text' });
                    } else {
                        _this.draw();
                    }
                }, function (e) {
                    log('Playlist load error:', e);
                    object.activity.loader(false);
                    Lampa.Noty.show('Не вдалося завантажити плейлист');
                }, false, { dataType: 'text' });
            };

            this.settingsPanel = function () {
                var panel = $('<div style="display:flex;gap:0.6em;padding:0 0 1em 0;flex-wrap:wrap;"></div>');

                var btnPlaylist = $(
                    '<div class="selector" style="padding:0.6em 1em;background:#333;border-radius:0.5em;color:#fff;">' +
                        '📺 Змінити плейлист' +
                    '</div>'
                );
                btnPlaylist.on('hover:enter', function () {
                    Lampa.Input.edit({
                        title: 'Посилання на M3U плейлист',
                        free: true,
                        nosave: true,
                        value: getPlaylistUrl()
                    }, function (value) {
                        if (value) {
                            Lampa.Storage.set('my_iptv_playlist_url', value);
                            Lampa.Noty.show('Плейлист збережено, оновлюю...');
                            channels = [];
                            epg = {};
                            _this_ref.load();
                        }
                        Lampa.Controller.toggle('content');
                    });
                });

                var btnEpg = $(
                    '<div class="selector" style="padding:0.6em 1em;background:#333;border-radius:0.5em;color:#fff;">' +
                        '📅 Змінити EPG (XMLTV)' +
                    '</div>'
                );
                btnEpg.on('hover:enter', function () {
                    Lampa.Input.edit({
                        title: 'Посилання на XMLTV (можна залишити порожнім)',
                        free: true,
                        nosave: true,
                        value: getEpgUrl()
                    }, function (value) {
                        Lampa.Storage.set('my_iptv_epg_url', value || '');
                        Lampa.Noty.show('EPG збережено, оновлюю...');
                        channels = [];
                        epg = {};
                        _this_ref.load();
                        Lampa.Controller.toggle('content');
                    });
                });

                panel.append(btnPlaylist);
                panel.append(btnEpg);
                return panel;
            };

            this.renderSettingsOnly = function () {
                body.empty();
                body.append(this.settingsPanel());
                body.append('<div style="color:#fff;opacity:0.7;padding:1em 0;">Вкажіть посилання на плейлист вище, щоб побачити канали.</div>');
                Lampa.Controller.collectionSet(scroll.render());
            };

            this.draw = function () {
                object.activity.loader(false);
                body.empty();
                body.append(this.settingsPanel());

                var groups = {};
                channels.forEach(function (c) {
                    (groups[c.group] = groups[c.group] || []).push(c);
                });

                Object.keys(groups).forEach(function (groupName) {
                    body.append(
                        '<div style="width:100%;color:#fff;font-size:1.3em;padding:0.6em 0;">' +
                        escapeHtml(groupName) +
                        '</div>'
                    );

                    groups[groupName].forEach(function (ch) {
                        var e = ch.tvgId ? epg[ch.tvgId] : null;
                        var fallbackLetter = ch.title ? ch.title.replace(/[^a-zA-Zа-яА-Я0-9]/g, '').slice(0, 2).toUpperCase() : '?';
                        var item = $(
                            '<div class="selector" style="display:flex;align-items:center;width:100%;margin:0.3em 0;padding:0.6em 0.8em;background:#222;border-radius:0.6em;">' +
                                (ch.logo
                                    ? '<img src="' + escapeHtml(ch.logo) + '" style="width:44px;height:44px;object-fit:contain;margin-right:0.8em;border-radius:0.3em;background:#111;flex-shrink:0;" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';">'
                                    : '') +
                                '<div style="width:44px;height:44px;margin-right:0.8em;border-radius:0.3em;background:#3a3a3a;flex-shrink:0;display:' + (ch.logo ? 'none' : 'flex') + ';align-items:center;justify-content:center;color:#fff;font-weight:700;">' + escapeHtml(fallbackLetter) + '</div>' +
                                '<div style="flex-grow:1;overflow:hidden;">' +
                                    '<div style="color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(ch.title) + '</div>' +
                                    (e ? '<div style="opacity:0.6;font-size:0.85em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + fmtTime(e.start) + '-' + fmtTime(e.stop) + ' ' + escapeHtml(e.title) + '</div>' : '') +
                                '</div>' +
                            '</div>'
                        );

                        item.on('hover:enter', function () {
                            Lampa.Player.play({ title: ch.title, url: ch.url, tv: true });
                            Lampa.Player.playlist(channels.map(function (c) {
                                return { title: c.title, url: c.url, tv: true };
                            }));
                        });

                        item.on('hover:focus', function () {
                            last = item;
                            scroll.update(item);
                        });

                        body.append(item);
                    });
                });

                Lampa.Controller.collectionSet(scroll.render());
            };

            this.pause = function () {};
            this.stop = function () {};
            this.destroy = function () {
                scroll.destroy();
                html.remove();
            };
        }

        function addMenuButton() {
            if ($('.menu [data-action="my_iptv"]').length) return;

            var button = $(
                '<li class="menu__item selector" data-action="my_iptv">' +
                    '<div class="menu__ico">' +
                        '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                            '<rect x="2" y="4" width="20" height="14" rx="2" stroke="currentColor" stroke-width="2"/>' +
                            '<path d="M8 21H16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
                            '<path d="M12 18V21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
                        '</svg>' +
                    '</div>' +
                    '<div class="menu__text">Мій IPTV</div>' +
                '</li>'
            );

            button.on('hover:enter', function () {
                Lampa.Activity.push({
                    url: '',
                    title: 'Мій IPTV',
                    component: 'my_iptv',
                    page: 1
                });
            });

            $('.menu .menu__list').eq(0).append(button);
        }

        function startPlugin() {
            Lampa.Component.add('my_iptv', Component);
            log('component registered');

            if (window.appready) addMenuButton();
            else {
                Lampa.Listener.follow('app', function (e) {
                    if (e.type === 'ready') addMenuButton();
                });
            }
        }

        startPlugin();
        log('plugin loaded successfully');
    } catch (err) {
        console.error('[MyIPTV] Помилка ініціалізації:', err);
    }
})();
