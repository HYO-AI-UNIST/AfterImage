import { env } from 'cloudflare:workers';
import { apiResponse, bearerToken, D1RoomStorage, readMutation, RoomError, RoomService } from '@/lib/room-service';

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  return apiResponse(async () => {
    const token = bearerToken(request);
    const body = await readMutation(request);
    const { code } = await context.params;
    if (!env.DB) throw new RoomError('온라인 방 연결을 준비 중이에요. 잠시 후 다시 시도해 주세요.', 503);
    return new RoomService(new D1RoomStorage(env.DB)).act(code, token, body.action, body.revision);
  });
}
