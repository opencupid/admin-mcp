import { describe, expect, it } from 'vitest'
import { redactContactPii } from '../redact.js'

describe('redactContactPii', () => {
  it('removes email and phonenumber at any depth', () => {
    const input = {
      profiles: [
        { id: 'p1', publicName: 'Samu', user: { email: 'a@b.c', phonenumber: '+361', id: 'u1' } },
      ],
      user: { email: 'x@y.z', isBlocked: false },
      total: 1,
    }
    expect(redactContactPii(input)).toEqual({
      profiles: [{ id: 'p1', publicName: 'Samu', user: { id: 'u1' } }],
      user: { isBlocked: false },
      total: 1,
    })
  })

  it('passes primitives and null through', () => {
    expect(redactContactPii(null)).toBeNull()
    expect(redactContactPii('email')).toBe('email')
    expect(redactContactPii(3)).toBe(3)
  })
})
