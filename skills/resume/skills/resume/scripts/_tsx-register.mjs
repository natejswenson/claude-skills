/**
 * Registers _tsx-loader.mjs as a module customization hook.
 * Usage: node --import ./scripts/_tsx-register.mjs scripts/<thing>.mjs
 */
import { register } from "node:module";
register("./_tsx-loader.mjs", import.meta.url);
