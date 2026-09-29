import type { Metadata } from 'next';
import AgentConsent from '@/components/account/AgentConsent';
export const metadata: Metadata = { title: 'Connect an agent · Scene Assembly', robots: { index: false, follow: false } };
export default async function ConnectAgentPage({searchParams}:{searchParams:Promise<{request?:string}>}) {
  const query = await searchParams;
  const requestId = typeof query.request === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(query.request) ? query.request : null;
  return <AgentConsent requestId={requestId} />;
}
