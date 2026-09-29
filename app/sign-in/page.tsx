import type { Metadata } from 'next';
import AccountAccess from '@/components/account/AccountAccess';
export const metadata: Metadata = { title: 'Sign in · Scene Assembly', robots: { index: false, follow: false } };
export default async function SignInPage({searchParams}:{searchParams:Promise<{account?:string;returnTo?:string}>}) { const query=await searchParams; return <AccountAccess mode="sign-in" signInFailed={query.account==='signin-failed'} returnTo={query.returnTo} />; }
