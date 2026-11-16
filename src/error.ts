/** Why portable-pg failed. Callers can branch on these; the values never change. */
export const PortablePgErrorCode = {
	DataDirectoryMode: 'DATA_DIRECTORY_MODE',
	DataDirectoryVersion: 'DATA_DIRECTORY_VERSION',
	StartFailed: 'START_FAILED',
	ConnectFailed: 'CONNECT_FAILED',
} as const;

export type PortablePgErrorCode = (typeof PortablePgErrorCode)[keyof typeof PortablePgErrorCode];

/** An error portable-pg raises itself, with a `code` to tell the cases apart. */
export class PortablePgError extends Error {
	readonly code: PortablePgErrorCode;

	constructor(code: PortablePgErrorCode, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'PortablePgError';
		this.code = code;
	}
}
