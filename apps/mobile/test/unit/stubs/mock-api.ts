// The unit tests drive the wire themselves (setTransport); the in-app mock is never used.
export async function mockTransport(): Promise<never> { throw new Error('mock transport not used in unit tests'); }
export type AreaMock = unknown;
