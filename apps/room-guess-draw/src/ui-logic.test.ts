import { describe, expect, it } from 'vitest';
import { categoryDialogRole, drawingPermissions } from './ui-logic';

describe('phase UI', () => {
  it('shows the picker to the drawer before drawing is allowed', () => { expect(drawingPermissions('choosing', 'a', 'a')).toEqual({ isCurrentDrawer: true, canDraw: false }); expect(categoryDialogRole('choosing', 'a', 'a', [], [])).toBe('classic-picker'); expect(categoryDialogRole('choosing', 'a', 'b', [], [])).toBe('classic-waiting'); });
  it('shows each relay participant a picker until submission', () => { expect(categoryDialogRole('relay-choosing', null, 'a', ['a', 'b'], [])).toBe('relay-picker'); expect(categoryDialogRole('relay-choosing', null, 'a', ['a', 'b'], ['a'])).toBe('relay-waiting'); });
});
