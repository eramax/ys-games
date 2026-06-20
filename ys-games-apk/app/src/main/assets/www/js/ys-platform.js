/**
 * YS Games — حفظ الحالة والتكامل مع تطبيق الأندرويد
 */
(function (global) {
  const SAVE_PREFIX = 'ys-games-save-';
  const META_KEY = 'ys-games-meta';

  function safeJsonParse(raw) {
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  const YSSave = {
    save(gameId, data) {
      try {
        localStorage.setItem(SAVE_PREFIX + gameId, JSON.stringify({
          v: 1,
          savedAt: Date.now(),
          data
        }));
        return true;
      } catch (e) {
        console.warn('YSSave.save failed', e);
        return false;
      }
    },

    load(gameId) {
      try {
        const raw = localStorage.getItem(SAVE_PREFIX + gameId);
        if (!raw) return null;
        const parsed = safeJsonParse(raw);
        return parsed?.data ?? null;
      } catch (_) {
        return null;
      }
    },

    has(gameId) {
      return !!localStorage.getItem(SAVE_PREFIX + gameId);
    },

    clear(gameId) {
      try { localStorage.removeItem(SAVE_PREFIX + gameId); } catch (_) {}
    },

    getMeta() {
      return safeJsonParse(localStorage.getItem(META_KEY)) || {};
    },

    setMeta(patch) {
      const meta = { ...YSSave.getMeta(), ...patch };
      try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (_) {}
      return meta;
    }
  };

  const YSApp = {
    isApp() {
      return new URLSearchParams(location.search).get('app') === 'true' ||
        !!global.AndroidBridge;
    },

    isOnline() {
      return navigator.onLine !== false;
    },

    getCachedVersion() {
      return YSSave.getMeta().cachedVersion ?? null;
    },

    async checkForUpdate(remoteVersionUrl) {
      if (!YSApp.isOnline()) return { updateAvailable: false };
      try {
        const res = await fetch(remoteVersionUrl + (remoteVersionUrl.includes('?') ? '&' : '?') + 't=' + Date.now());
        if (!res.ok) return { updateAvailable: false };
        const remote = await res.json();
        const local = YSApp.getCachedVersion();
        return {
          updateAvailable: remote.version > (local || 0),
          remoteVersion: remote.version,
          localVersion: local
        };
      } catch (_) {
        return { updateAvailable: false };
      }
    },

    triggerUpdate() {
      if (global.AndroidBridge?.updateGames) {
        global.AndroidBridge.updateGames();
        return true;
      }
      return false;
    },

    onUpdateProgress(cb) {
      YSApp._progressCb = cb;
    },

    _notifyProgress(percent, message) {
      if (typeof YSApp._progressCb === 'function') {
        YSApp._progressCb(percent, message);
      }
    }
  };

  global.YSSave = YSSave;
  global.YSApp = YSApp;

  global.onGamesUpdateProgress = function (percent, message) {
    YSApp._notifyProgress(percent, message || '');
  };

  global.onGamesUpdateComplete = function (ok, message) {
    document.dispatchEvent(new CustomEvent('ys-games-updated', {
      detail: { ok: !!ok, message: message || '' }
    }));
  };
})(window);
