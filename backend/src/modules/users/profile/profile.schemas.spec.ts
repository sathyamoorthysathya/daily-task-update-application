import { updateProfileSchema } from './profile.schemas.js';

const parse = (input: unknown) => updateProfileSchema.safeParse(input);

describe('updateProfileSchema', () => {
  it('accepts a complete, valid profile and normalises text', () => {
    const result = parse({
      name: '  Jane Doe ',
      phone: '+1  (555) 123-4567',
      companyName: ' Acme Corp ',
      jobRole: 'Project Manager',
      industry: 'Information Technology',
      yearsOfExperience: 7,
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      name: 'Jane Doe',
      phone: '+1 (555) 123-4567',
      companyName: 'Acme Corp',
      jobRole: 'Project Manager',
      industry: 'Information Technology',
      yearsOfExperience: 7,
    });
  });

  it('supports partial updates and clearing optional fields', () => {
    expect(parse({ jobRole: 'Engineer' }).data).toEqual({ jobRole: 'Engineer' });
    expect(
      parse({ phone: '', companyName: null, industry: '', yearsOfExperience: null }).data,
    ).toEqual({
      phone: null,
      companyName: null,
      industry: null,
      yearsOfExperience: null,
    });
  });

  it.each([
    ['letters in the phone number', { phone: 'call me' }],
    ['too few digits', { phone: '12345' }],
    ['too many digits', { phone: '+1234567890123456' }],
    ['an unknown industry', { industry: 'Space Piracy' }],
    ['negative experience', { yearsOfExperience: -1 }],
    ['excessive experience', { yearsOfExperience: 61 }],
    ['fractional experience', { yearsOfExperience: 2.5 }],
    ['experience as text', { yearsOfExperience: '5' }],
    ['an empty name', { name: '   ' }],
    ['a null name', { name: null }],
    ['an over-long company name', { companyName: 'x'.repeat(121) }],
  ])('rejects %s', (_case, input) => {
    expect(parse(input).success).toBe(false);
  });

  it('rejects fields that cannot be changed here', () => {
    const result = parse({ name: 'Jane', email: 'new@example.com', emailVerified: true });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Field cannot be changed: email, emailVerified');
  });
});
