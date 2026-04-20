import { eq } from 'drizzle-orm';
import { logger } from '../shared/logger.js';
import { getDb } from '../shared/db.js';
import { users } from '../shared/schema.js';
import {
  dispatch,
  type ApiGatewayV2HttpEvent,
  type ApiGatewayV2HttpResponse,
  type BedrockActionGroupEvent,
  type BedrockActionGroupResponse,
  type Routes,
} from '../shared/responses.js';
import { GetUserProfileInput } from '../shared/schemas.js';

async function getUserProfile(params: Record<string, string>) {
  const { userId } = GetUserProfileInput.parse(params);
  const rows = await getDb()
    .select({
      userId: users.userId,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      phone: users.phone,
      nationality: users.nationality,
    })
    .from(users)
    .where(eq(users.userId, userId))
    .limit(1);
  if (rows.length === 0) {
    return {
      statusCode: 404,
      body: { success: false, error: { code: 'NOT_FOUND', message: 'User not found' } },
    };
  }
  return { statusCode: 200, body: { success: true, data: rows[0] } };
}

const routes: Routes = {
  '/users/profile': getUserProfile,
};

export const handler = async (
  event: BedrockActionGroupEvent | ApiGatewayV2HttpEvent,
): Promise<BedrockActionGroupResponse | ApiGatewayV2HttpResponse> => {
  logger.info('users-actions invoked');
  return dispatch(event, routes);
};
