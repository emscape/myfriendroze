'use strict';

const fs = require('fs');
const path = require('path');

// Guards a project-local file may tighten (enabled:true) but never disable.
const PROTECTED_SECTIONS = ['merge_guard', 'env_guard', 'branch_delete_guard'];

function resolveProjectDir({ projectDir, env = process.env, cwd = process.cwd() } = {}) {
  if (projectDir) return projectDir;
  if (env && env.CLAUDE_PROJECT_DIR) return env.CLAUDE_PROJECT_DIR;
  return cwd;
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Windows PowerShell 5.1 writes UTF-8 with a BOM, which JSON.parse rejects.
const readText = (file) => fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');

// Keys that could alter a prototype, and a nesting limit that keeps recursion far from stack overflow.
const HOSTILE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = 32;

function warn(message) {
  process.stderr.write(`[hook-config] WARN: ${message}\n`);
}

// Copies an untrusted override into plain objects, dropping hostile keys; throws past MAX_DEPTH.
function sanitize(value, depth = 0) {
  if (value === null || typeof value !== 'object') return value;
  if (depth > MAX_DEPTH) throw new Error('nesting deeper than ' + MAX_DEPTH + ' levels');
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
  const out = {};
  for (const key of Object.keys(value)) {
    if (HOSTILE_KEYS.has(key)) {
      warn('project override key "' + key + '" ignored (unsafe key)');
      continue;
    }
    out[key] = sanitize(value[key], depth + 1);
  }
  return out;
}

// Objects merge recursively; arrays, scalars and null replace. Always returns fresh copies.
function deepMerge(base, over) {
  if (!isPlainObject(base) || !isPlainObject(over)) return structuredClone(over);
  const out = structuredClone(base);
  for (const key of Object.keys(over)) {
    out[key] = Object.hasOwn(out, key) ? deepMerge(out[key], over[key]) : structuredClone(over[key]);
  }
  return out;
}

function stripProtectedDisables(override) {
  const cleaned = { ...override };
  for (const section of PROTECTED_SECTIONS) {
    if (!(section in cleaned)) continue;
    if (!isPlainObject(cleaned[section])) {
      delete cleaned[section];
      warn(`project override for protected guard "${section}" must be an object; ignoring it`);
    } else if ('enabled' in cleaned[section] && cleaned[section].enabled !== true) {
      const { enabled, ...rest } = cleaned[section];
      cleaned[section] = rest;
      warn(`project override cannot disable protected guard "${section}"; ignoring ${section}.enabled=${JSON.stringify(enabled)} (only boolean true is allowed)`);
    }
  }
  return cleaned;
}

function readOverride(overridePath) {
  let raw;
  try {
    raw = readText(overridePath);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    warn(`cannot read ${overridePath} (${err.message}); ignoring project overrides`);
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (isPlainObject(parsed)) return parsed;
    warn(`${overridePath} must contain a JSON object; ignoring project overrides`);
  } catch (err) {
    warn(`${overridePath} is not valid JSON (${err.message}); ignoring project overrides`);
  }
  return null;
}

// Throws if the shared config is unreadable; a broken project override never throws.
function loadHookConfig({ hooksDir, projectDir, env, cwd } = {}) {
  const shared = JSON.parse(readText(path.join(hooksDir, 'config.json')));
  const dir = resolveProjectDir({ projectDir, env, cwd });
  const overridePath = path.join(dir, '.claude', 'hooks.config.json');
  const override = readOverride(overridePath);
  if (!override) return shared;
  try {
    return deepMerge(shared, stripProtectedDisables(sanitize(override)));
  } catch (err) {
    warn(`${overridePath} could not be applied (${err.message}); ignoring project overrides`);
    return shared;
  }
}

module.exports = { loadHookConfig, resolveProjectDir };
