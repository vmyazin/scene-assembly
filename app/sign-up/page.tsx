import type { Metadata } from 'next';
import AccountAccess from '@/components/account/AccountAccess';
export const metadata: Metadata = { title: 'Create an account · Scene Assembly', robots: { index: false, follow: false } };
export default async function SignUpPage({searchParams}:{searchParams:Promise<{returnTo?:string}>}) { const query=await searchParams; return <AccountAccess mode="sign-up" returnTo={query.returnTo} />; }
