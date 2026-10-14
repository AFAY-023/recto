import Anthropic from '@anthropic-ai/sdk';
import type { Provider } from './types';

export interface KeyCheck {
  ok: boolean;
  message: string;
}

/**
 * Verifies a key with a free, read-only call: DeepSeek's balance endpoint, or
 * listing one Claude model. Reports the provider's own error text on failure.
 */
export async function checkKey(provider: Provider, key: string): Promise<KeyCheck> {
  if (!key) return { ok: false, message: '还没有填写 Key。' };
  if (provider === 'deepseek') {
    let res: Response;
    try {
      res = await fetch('https://api.deepseek.com/user/balance', { headers: { Authorization: `Bearer ${key}` } });
    } catch {
      return { ok: false, message: '无法连接到 DeepSeek，请检查网络。' };
    }
    const body = (await res.json().catch(() => null)) as {
      is_available?: boolean;
      balance_infos?: { currency: string; total_balance: string }[];
      error?: { message?: string };
    } | null;
    if (!res.ok) return { ok: false, message: `DeepSeek 返回 ${res.status}：${body?.error?.message ?? res.statusText}` };
    const b = body?.balance_infos?.[0];
    const balance = b ? `余额 ${b.total_balance} ${b.currency}` : '余额未知';
    return body?.is_available === false
      ? { ok: false, message: `Key 有效，但账户不可用（${balance}），请先充值。` }
      : { ok: true, message: `Key 有效 · ${balance}` };
  }
  try {
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 0 });
    await client.models.list({ limit: 1 });
    return { ok: true, message: 'Key 有效' };
  } catch (error) {
    if (error instanceof Anthropic.APIError) return { ok: false, message: `Anthropic 返回 ${error.status ?? ''}：${error.message}` };
    return { ok: false, message: '无法连接到 Anthropic，请检查网络。' };
  }
}
