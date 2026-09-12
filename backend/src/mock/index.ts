/**
 * MOCK_MODE: stand-ins for the services that reach outside the process, so the whole app can run, and be
 * screenshotted, without aMule, Gluetun, Telegram or internet access.
 *
 * How it fits together:
 * - index.ts registers each mock under the real class (`container.register(AmuleService, new MockAmuleService())`).
 *   ServiceContainer.register accepts anything with the same public surface, so a mock is a plain class and
 *   a missing method is a compile error. Everything else (controllers, MediaProviderService, WsBroadcastService,
 *   ExtensionsService, MainDB...) is the real code running on top of the mocks.
 * - MockWorld holds the simulated state (queue, servers, shared files, Telegram index, log) and moves it with
 *   the wall clock; fixtures.ts holds the static content; MockRandom makes it all reproducible.
 * - createMockDatabase resets and seeds the database under the OS temp directory on every start (see app-env.ts).
 */
export { createMockDatabase } from './createMockDatabase';
export { MockAmuledService } from './MockAmuledService';
export { MockAmuleService } from './MockAmuleService';
export { MockGluetunService } from './MockGluetunService';
export { MockSpeedHistoryService } from './MockSpeedHistoryService';
export { MockSystemService } from './MockSystemService';
export { MockTelegramIndexerService } from './MockTelegramIndexerService';
