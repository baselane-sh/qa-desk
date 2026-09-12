import { validateConfig } from '../../scripts/lib/config.mjs';

const raw = {
  project: 'QA',
  components: [
    { name: 'auth', sources: ['src/auth/login.ts', 'src/auth/otp.ts'], notes: '' },
    { name: 'billing', sources: ['src/billing/invoice.ts'], notes: '' },
  ],
  roles: ['admin', 'user'],
  gates: ['npm test'],
};

const result = validateConfig(raw);
if (!result.ok) throw new Error(`TEST_CONFIG invalid: ${result.problems.join('; ')}`);
export const TEST_CONFIG = result.config;

export function sampleCase(overrides = {}) {
  return {
    id: 'QA-0001',
    title: 'Login with a valid OTP',
    objective: 'Prove a user with a valid OTP reaches the home screen',
    component: 'auth',
    actors: ['user'],
    type: 'functional',
    priority: 'P1',
    severity: 'major',
    env: 'any',
    locale: 'any',
    preconditions: ['USER_A exists and is signed out'],
    testData: 'phone +10000000001',
    steps: [
      { action: 'Open the app', expected: 'The phone entry screen is shown' },
      { action: 'Enter the phone and the OTP', expected: 'The home screen is shown', data: 'OTP 123456' },
    ],
    postconditions: [],
    references: ['REQ-12'],
    tags: ['smoke'],
    automation: 'manual',
    estimateMinutes: 3,
    source: ['src/auth/login.ts'],
    ...overrides,
  };
}
