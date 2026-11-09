import { ApiProperty } from '@nestjs/swagger';

export class UserProfileDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'jane@example.com' })
  email!: string;

  @ApiProperty({ example: 'Jane Doe' })
  name!: string;

  @ApiProperty({ description: 'Ownership of the email address has been proven' })
  emailVerified!: boolean;

  @ApiProperty({ description: 'The account can sign in with a password' })
  hasPassword!: boolean;

  @ApiProperty({ example: ['google'], description: 'Linked external sign-in providers' })
  providers!: string[];

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Version of the uploaded avatar (GET /profile/avatar?v=<version>); null if none',
  })
  avatarVersion!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Picture from a linked provider (e.g. Google), shown when no avatar is uploaded',
  })
  providerPictureUrl!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}
