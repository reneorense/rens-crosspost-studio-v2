export async function fetchBackend(action: string, payload: any = {}): Promise<any> {
  try {
    const response = await fetch('/api/server', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action, ...payload }),
    });

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || `HTTP error! status: ${response.status}`);
      }
      return result;
    } else {
      const text = await response.text();
      throw new Error(`Invalid response format from server: ${text.slice(0, 100)}`);
    }
  } catch (error: any) {
    console.error(`Backend call [${action}] failed:`, error);
    throw error;
  }
}
