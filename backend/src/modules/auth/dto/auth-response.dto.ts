import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserProfileDto } from '../../users/dto/user-profile.dto.js';

export class AuthResponseDto {
  @ApiProperty({ type: UserProfileDto })
  user!: UserProfileDto;
}

export class CsrfTokenDto {
  @ApiProperty({ description: 'Send this value in the X-CSRF-Token header of unsafe requests' })
  csrfToken!: string;
}

export class GoogleProviderDto {
  @ApiProperty()
  enabled!: boolean;

  @ApiPropertyOptional({ description: 'OAuth client ID for Google Identity Services' })
  clientId?: string;
}

export class AuthProvidersDto {
  @ApiProperty({ type: GoogleProviderDto })
  google!: GoogleProviderDto;
}

export class GoogleNonceDto {
  @ApiProperty({ description: 'Pass to Google Identity Services as `nonce`' })
  nonce!: string;
}

export class MessageDto {
  @ApiProperty()
  message!: string;
}
