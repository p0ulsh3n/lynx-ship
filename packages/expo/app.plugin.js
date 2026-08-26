// Expo resolves package config plugins through this conventional entry point.
// Keep the implementation CommonJS so it can be evaluated by Expo's Node.js
// config phase regardless of the consuming app's module configuration.
module.exports = require("./app.plugin.cjs");
