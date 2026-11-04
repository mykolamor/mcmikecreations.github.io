import type { FieldOp } from '../../shared/ops';

/** The edit that undoes an `updated:` stamp: the previous date, or null (= remove the key) when the post had none. */
export function undoUpdatedOp(previous: string | null | undefined): FieldOp {
	return { field: 'post.updated', value: previous ?? null };
}
