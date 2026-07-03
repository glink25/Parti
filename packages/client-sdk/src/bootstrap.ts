/**
 * 注入到 Room UI iframe 的 Client SDK 引导脚本 (GOAL.md §10.2)。
 *
 * 以纯 JS 字符串形式提供，便于宿主页直接写入 sandbox iframe 的 srcdoc，
 * 无需对房间代码做任何打包。建立 `window.parti` 全局，所有通信经 postMessage，
 * 不直接触网、不访问 transport（§4.4）。
 */
export const CLIENT_SDK_SCRIPT = String.raw`
(function () {
  var TAG = '__parti';
  var currentState = null;
  var playerId = null;
  var ready = false;
  var stateHandlers = [];
  var eventHandlers = {}; // event -> [fn]
  var orientationStatus = 'unsupported';
  var orientationStatusHandlers = [];
  var orientationDataHandlers = [];
  var orientationRequests = {};
  var nextOrientationRequestId = 1;

  function postToHost(msg) {
    msg[TAG] = true;
    parent.postMessage(msg, '*');
  }

  function notifyState() {
    for (var i = 0; i < stateHandlers.length; i++) {
      try { stateHandlers[i](currentState); } catch (e) { console.error(e); }
    }
  }

  function notifyEvent(event, payload) {
    var list = eventHandlers[event] || [];
    for (var i = 0; i < list.length; i++) {
      try { list[i](payload); } catch (e) { console.error(e); }
    }
  }

  function notifyOrientationStatus(status) {
    orientationStatus = status;
    for (var i = 0; i < orientationStatusHandlers.length; i++) {
      try { orientationStatusHandlers[i](status); } catch (e) { console.error(e); }
    }
  }

  function notifyOrientationData(data) {
    for (var i = 0; i < orientationDataHandlers.length; i++) {
      try { orientationDataHandlers[i](data); } catch (e) { console.error(e); }
    }
  }

  window.addEventListener('message', function (e) {
    var msg = e.data;
    if (!msg || msg[TAG] !== true) return;
    switch (msg.type) {
      case 'init':
        playerId = msg.playerId;
        currentState = msg.state;
        window.parti.playerId = playerId;
        notifyState();
        break;
      case 'state':
        currentState = msg.state;
        notifyState();
        break;
      case 'event':
        notifyEvent(msg.event, msg.payload);
        break;
      case 'orientation-status':
        notifyOrientationStatus(msg.status);
        if (msg.requestId !== undefined && orientationRequests[msg.requestId]) {
          orientationRequests[msg.requestId](msg.status);
          delete orientationRequests[msg.requestId];
        }
        break;
      case 'orientation-data':
        notifyOrientationData(msg.data);
        break;
      case 'error':
        notifyEvent('__error', { code: msg.code, message: msg.message });
        break;
    }
  });

  window.parti = {
    playerId: null,

    getState: function () { return currentState; },

    onState: function (handler) {
      stateHandlers.push(handler);
      if (currentState !== null) {
        try { handler(currentState); } catch (e) { console.error(e); }
      }
      return function () {
        var i = stateHandlers.indexOf(handler);
        if (i >= 0) stateHandlers.splice(i, 1);
      };
    },

    onEvent: function (event, handler) {
      if (!eventHandlers[event]) eventHandlers[event] = [];
      eventHandlers[event].push(handler);
      return function () {
        var list = eventHandlers[event] || [];
        var i = list.indexOf(handler);
        if (i >= 0) list.splice(i, 1);
      };
    },

    action: function (action, payload) {
      postToHost({ type: 'action', action: action, payload: payload === undefined ? null : payload });
      return Promise.resolve({ ok: true });
    },

    ready: function () {
      if (ready) return;
      ready = true;
      postToHost({ type: 'ready' });
    },

    leave: function () { postToHost({ type: 'leave' }); },

    orientation: {
      getStatus: function () { return orientationStatus; },
      requestPermission: function () {
        var requestId = nextOrientationRequestId++;
        return new Promise(function (resolve) {
          orientationRequests[requestId] = resolve;
          postToHost({ type: 'orientation-request', requestId: requestId });
        });
      },
      onStatus: function (handler) {
        orientationStatusHandlers.push(handler);
        try { handler(orientationStatus); } catch (e) { console.error(e); }
        return function () {
          var i = orientationStatusHandlers.indexOf(handler);
          if (i >= 0) orientationStatusHandlers.splice(i, 1);
        };
      },
      onData: function (handler) {
        orientationDataHandlers.push(handler);
        return function () {
          var i = orientationDataHandlers.indexOf(handler);
          if (i >= 0) orientationDataHandlers.splice(i, 1);
        };
      }
    },

    log: function () {
      var args = Array.prototype.slice.call(arguments);
      postToHost({ type: 'log', args: args });
    }
  };

  // 通知宿主页：iframe 已就绪，请下发 init
  postToHost({ type: 'hello' });
})();
`;
