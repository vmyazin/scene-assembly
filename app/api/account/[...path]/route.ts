import { accountGateway } from '@/lib/account/gateway';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The YouTube import holds its request for up to 130 s; every other account route
// answers well inside the gateway's own 25 s upstream timeout.
export const maxDuration = 150;
export const GET = accountGateway;
export const POST = accountGateway;
export const DELETE = accountGateway;
