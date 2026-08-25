import assert from 'node:assert/strict';
import test from 'node:test';
import { getConfiguredDeprecatedLegacySettings } from '../../src/config';

test('legacy UDP capture settings are reported as deprecated and ignored', () => {
  assert.deepEqual(getConfiguredDeprecatedLegacySettings({ LIVE_UDP_ENABLED: 'true', LIVE_UDP_DEBUG: 'true' }), [
    'LIVE_UDP_ENABLED',
    'LIVE_UDP_DEBUG'
  ]);
});

test('legacy incident persistence settings are reported without enabling live writes', () => {
  assert.deepEqual(getConfiguredDeprecatedLegacySettings({ INCIDENT_DEBUG: 'true', INCIDENT_PRE_MS: '3000' }), [
    'INCIDENT_PRE_MS',
    'INCIDENT_DEBUG'
  ]);
});

test('legacy snapshot settings are ignored rather than creating telemetry state', () => {
  assert.deepEqual(getConfiguredDeprecatedLegacySettings({ SNAPSHOT_RING_BUFFER_MS: '10000', INCIDENT_POST_MS: '1500' }), [
    'SNAPSHOT_RING_BUFFER_MS',
    'INCIDENT_POST_MS'
  ]);
});

test('legacy UDP endpoint settings are compatibility inputs only', () => {
  assert.deepEqual(getConfiguredDeprecatedLegacySettings({ AC_UDP_SERVER_HOST: '127.0.0.1', AC_UDP_SERVER_PLUGIN_PORT: '11000' }), [
    'AC_UDP_SERVER_HOST',
    'AC_UDP_SERVER_PLUGIN_PORT'
  ]);
});

test('legacy matching settings are compatibility inputs only', () => {
  assert.deepEqual(getConfiguredDeprecatedLegacySettings({ INCIDENT_MATCH_MAX_DISTANCE_M: '30', INCIDENT_MATCH_MAX_IMPACT_DIFF_KMH: '35' }), [
    'INCIDENT_MATCH_MAX_DISTANCE_M',
    'INCIDENT_MATCH_MAX_IMPACT_DIFF_KMH'
  ]);
});
