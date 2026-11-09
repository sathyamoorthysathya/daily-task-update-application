import { ApiProperty } from '@nestjs/swagger';
import { INDUSTRIES } from '../industries.js';

export class ConnectedAccountDto {
  @ApiProperty({ example: 'google' })
  provider!: string;

  @ApiProperty({ type: String, nullable: true, example: 'jane@gmail.com' })
  email!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Jane Doe' })
  name!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Profile picture URL from the provider',
  })
  pictureUrl!: string | null;

  @ApiProperty({ format: 'date-time' })
  connectedAt!: string;

  @ApiProperty({ format: 'date-time' })
  lastLoginAt!: string;
}

export class ProfileDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'jane@example.com', description: 'Sign-in email (read-only)' })
  email!: string;

  @ApiProperty({ example: 'Jane Doe' })
  name!: string;

  @ApiProperty()
  emailVerified!: boolean;

  @ApiProperty({ description: 'The account can sign in with a password' })
  hasPassword!: boolean;

  @ApiProperty({ type: String, nullable: true, example: '+1 555 123 4567' })
  phone!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Acme Corp' })
  companyName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Project Manager' })
  jobRole!: string | null;

  @ApiProperty({ type: String, nullable: true, enum: INDUSTRIES })
  industry!: string | null;

  @ApiProperty({ type: Number, nullable: true, minimum: 0, maximum: 60, example: 5 })
  yearsOfExperience!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Version of the uploaded avatar (GET /profile/avatar?v=<version>); null if none',
  })
  avatarVersion!: number | null;

  @ApiProperty({ type: [ConnectedAccountDto] })
  connectedAccounts!: ConnectedAccountDto[];

  @ApiProperty({ format: 'date-time', description: 'Account creation date' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class IndustriesDto {
  @ApiProperty({ type: [String], example: INDUSTRIES })
  industries!: string[];
}
