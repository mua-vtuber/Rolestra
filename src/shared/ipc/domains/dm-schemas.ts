import { z } from 'zod';

/**
 * R10-Task3: `dm:create` — providerId 를 받아 1:1 DM 채널을 연다.
 * UNIQUE 위반(이미 DM 이 있는 provider) 은 service 계층에서 throw.
 */
export const dmCreateSchema = z.object({
  providerId: z.string().min(1).max(128),
});

/** R10-Task3: `dm:list` 는 입력이 없다. */
export const dmListSchema = z.undefined();

export const dmChannelSchemas = {
  'dm:list': dmListSchema,
  'dm:create': dmCreateSchema,
} as const;
