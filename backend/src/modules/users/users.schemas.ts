import { z } from 'zod';

export const userIdParamSchema = z.uuid('Invalid user ID');
