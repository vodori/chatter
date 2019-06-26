"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const rxjs_1 = require("rxjs");
exports._global = window;
exports._chrome = exports._global.chrome;
exports._window = exports._global.window;
exports._document = exports._global.document;
exports._localMessageBus = new rxjs_1.Subject();
var NetProto;
(function (NetProto) {
    NetProto[NetProto["BROADCAST"] = "BROADCAST"] = "BROADCAST";
    NetProto[NetProto["POINT_TO_POINT"] = "POINT_TO_POINT"] = "POINT_TO_POINT";
})(NetProto = exports.NetProto || (exports.NetProto = {}));
var AppProto;
(function (AppProto) {
    AppProto[AppProto["PUSH"] = "PUSH"] = "PUSH";
    AppProto[AppProto["REQUEST"] = "REQUEST"] = "REQUEST";
    AppProto[AppProto["SUBSCRIPTION"] = "SUBSCRIPTION"] = "SUBSCRIPTION";
})(AppProto = exports.AppProto || (exports.AppProto = {}));
function defaultSettings() {
    return { trustedOrigins: new Set() };
}
exports.defaultSettings = defaultSettings;
