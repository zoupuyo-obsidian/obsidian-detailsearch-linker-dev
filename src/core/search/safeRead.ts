export async function safeRead<T>(
	path: string,
	read: () => Promise<T>,
	onError: (path: string, error: unknown) => void,
): Promise<T | null> {
	try {
		return await read();
	} catch (error) {
		onError(path, error);
		return null;
	}
}
