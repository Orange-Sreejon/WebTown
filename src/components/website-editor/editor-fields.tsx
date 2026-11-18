import type { ChangeEvent, ReactNode, Ref } from 'react'
import { normalizeHexColour } from '../../personal-spaces/website/contrast'
import { normalizeText, textLength } from '../../personal-spaces/website/site-text'

/** A stable DOM id for the field at `path` (`projects[0].title` -> `we-projects-0-title`). */
export function fieldId(path: string): string {
  return `we-${path.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')}`
}

interface FieldBase {
  /** Where the field is in the site, in the same form validation reports: `profile.tagline`. */
  path: string
  label: string
  /** The current problem with this field, in words; shown only when there is one. */
  error?: string | undefined
  /** A short line of help. */
  hint?: string | undefined
  inputRef?: Ref<HTMLInputElement & HTMLTextAreaElement> | undefined
  onBlur?: (() => void) | undefined
}

/** The wording shared by every field: help, counter and problem, wired to the input for screen readers. */
function Described({
  base,
  counter,
  children,
}: {
  base: FieldBase
  counter: string | null
  children: (describedBy: string | undefined, invalid: boolean) => ReactNode
}): React.ReactElement {
  const id = fieldId(base.path)
  const ids = [
    base.hint ? `${id}-hint` : null,
    counter ? `${id}-count` : null,
    base.error ? `${id}-error` : null,
  ].filter((value): value is string => value !== null)

  return (
    <div className="we-field" data-invalid={base.error ? 'true' : undefined}>
      <label htmlFor={id} className="we-label">{base.label}</label>
      {children(ids.length > 0 ? ids.join(' ') : undefined, Boolean(base.error))}
      {base.hint && <p id={`${id}-hint`} className="we-hint">{base.hint}</p>}
      {counter && <p id={`${id}-count`} className="we-count">{counter}</p>}
      {base.error && (
        <p id={`${id}-error`} className="we-error">
          <span className="we-error-label">Problem: </span>
          {base.error}
        </p>
      )}
    </div>
  )
}

interface TextFieldProps extends FieldBase {
  value: string
  onChange: (value: string) => void
  /** The most characters allowed. Shown as a count; the text is never cut off. */
  limit?: number | undefined
  multiline?: boolean | undefined
  rows?: number | undefined
}

/**
 * A text box or text area. There is deliberately no `maxLength`: pasting more
 * than the limit keeps all of it and says so, instead of silently cutting it.
 */
export function TextField(props: TextFieldProps): React.ReactElement {
  const { path, value, onChange, limit, multiline = false, rows = 5, inputRef, onBlur } = props
  const count = limit === undefined ? null : textLength(normalizeText(value, multiline))
  const counter =
    limit === undefined || count === null ? null : count > limit ? `${count} of ${limit} characters (too long)` : `${count} of ${limit} characters`

  return (
    <Described base={props} counter={counter}>
      {(describedBy, invalid) =>
        multiline ? (
          <textarea
            id={fieldId(path)}
            className="we-input"
            value={value}
            rows={rows}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
            onBlur={onBlur}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            ref={inputRef as Ref<HTMLTextAreaElement>}
            spellCheck
          />
        ) : (
          <input
            id={fieldId(path)}
            className="we-input"
            type="text"
            value={value}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
            onBlur={onBlur}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            ref={inputRef as Ref<HTMLInputElement>}
            autoComplete="off"
          />
        )
      }
    </Described>
  )
}

interface UrlFieldProps extends FieldBase {
  value: string
  onChange: (value: string) => void
}

/** An address box. The rules are the website's own URL policy; this only shows what it says. */
export function UrlField(props: UrlFieldProps): React.ReactElement {
  const { path, value, onChange, inputRef, onBlur } = props
  return (
    <Described base={props} counter={null}>
      {(describedBy, invalid) => (
        <input
          id={fieldId(path)}
          className="we-input"
          type="text"
          inputMode="url"
          value={value}
          placeholder="https://example.com/"
          onChange={event => onChange(event.target.value)}
          onBlur={onBlur}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          ref={inputRef as Ref<HTMLInputElement>}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
      )}
    </Described>
  )
}

interface ColourFieldProps extends FieldBase {
  value: string
  onChange: (value: string) => void
}

/** A colour written as `#RRGGBB`, with the browser's colour picker beside it. */
export function ColourField(props: ColourFieldProps): React.ReactElement {
  const { path, label, value, onChange, onBlur } = props
  const valid = normalizeHexColour(value)
  return (
    <Described base={props} counter={null}>
      {(describedBy, invalid) => (
        <span className="we-colour">
          <input
            id={fieldId(path)}
            className="we-input we-input--colour"
            type="text"
            value={value}
            onChange={event => onChange(event.target.value)}
            onBlur={onBlur}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            autoComplete="off"
            spellCheck={false}
            maxLength={9}
          />
          <input
            type="color"
            className="we-picker"
            value={valid === null ? '#000000' : valid.toLowerCase()}
            onChange={event => onChange(event.target.value.toUpperCase())}
            aria-label={`${label}: choose with the colour picker`}
          />
        </span>
      )}
    </Described>
  )
}

interface SelectFieldProps<T extends string> extends FieldBase {
  value: T
  options: ReadonlyArray<{ value: T; label: string; disabled?: boolean }>
  onChange: (value: T) => void
}

export function SelectField<T extends string>(props: SelectFieldProps<T>): React.ReactElement {
  const { path, value, options, onChange, onBlur } = props
  return (
    <Described base={props} counter={null}>
      {(describedBy, invalid) => (
        <select
          id={fieldId(path)}
          className="we-input"
          value={value}
          onChange={event => onChange(event.target.value as T)}
          onBlur={onBlur}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
        >
          {options.map(option => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Described>
  )
}

export function CheckboxField({
  path,
  label,
  checked,
  onChange,
  hint,
}: {
  path: string
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  hint?: string
}): React.ReactElement {
  const id = fieldId(path)
  return (
    <div className="we-field we-field--check">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={event => onChange(event.target.checked)}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      <label htmlFor={id} className="we-label">{label}</label>
      {hint && <p id={`${id}-hint`} className="we-hint">{hint}</p>}
    </div>
  )
}
