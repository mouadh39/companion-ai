import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../app_state.dart';
import '../theme/nexa_theme.dart';
import '../widgets/nexa_controls.dart';
import '../widgets/nexa_mark.dart';
import '../widgets/nexa_wordmark.dart';
import '../widgets/provider_glyphs.dart';
import 'auth_error_text.dart';

/// The identity providers the design offers, in order. All four are drawn as
/// the approved design shows them — monochrome silhouettes, so three
/// saturated brand logos never outshout Nexa — but **none is wired to a real
/// provider yet**: tapping one says so honestly rather than pretending a
/// sign-in happened. Email/password below is the real authentication this
/// build has.
const _providers = <({String label, AuthBrand brand, String kind})>[
  (label: 'Continue with Google', brand: AuthBrand.google, kind: 'Google'),
  (label: 'Continue with Apple', brand: AuthBrand.apple, kind: 'Apple'),
  (label: 'Continue with Meta', brand: AuthBrand.meta, kind: 'Meta'),
  (label: 'Continue with a passkey', brand: AuthBrand.passkey, kind: 'Passkey'),
];

/// Sign in, create account, and password reset — one surface, the title and
/// body swapping without it ever feeling like a navigation.
///
/// The providers and the email form sit on the same screen (no sub-modes):
/// the four provider rows, an "or use email" rule, then the real
/// email/password form. Reset is its own body.
class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key});

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  /// Set when a provider row is tapped — an honest "not connected yet"
  /// line, not a navigation.
  String? _providerNotice;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final state = NexaScope.of(context);
    final isForgot = state.screen == NexaScreen.forgot;
    final isLogin = state.screen == NexaScreen.login;

    final title = isForgot
        ? 'Reset your access.'
        : isLogin
            ? 'Welcome back.'
            : 'Welcome to Nexa';
    final subtitle = isForgot
        ? 'We will send a link to your email.'
        : isLogin
            ? 'Sign in to your Nexa account.'
            : 'Create your account with an email and a password.';

    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: RadialGradient(
          center: const Alignment(0, -1),
          radius: 1.1,
          colors: [c.groundTop, c.void_],
          stops: const [0.0, 0.68],
        ),
      ),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(30, 52, 30, 40),
          child: ConstrainedBox(
            constraints: BoxConstraints(
              minHeight:
                  (MediaQuery.sizeOf(context).height - 92).clamp(0.0, 4000.0),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                NexaBackButton(
                  onTap: () => state.back(
                    fallback: isForgot ? NexaScreen.login : NexaScreen.welcome,
                  ),
                ),
                const SizedBox(height: 22),
                Row(
                  children: [
                    const NexaMark(size: 34, glow: 20, glowOpacity: 0.35),
                    const SizedBox(width: 13),
                    NexaWordmark(size: 12, tracking: 0.5, color: c.ink72),
                  ],
                ),
                const SizedBox(height: 22),
                Text(
                  title,
                  style: NexaType.display(size: 29).copyWith(height: 1.16),
                ),
                const SizedBox(height: 9),
                Text(
                  subtitle,
                  style: NexaType.body(size: 14.5, color: c.ink45),
                ),
                if (isForgot)
                  const _ForgotBody()
                else ...[
                  const SizedBox(height: 28),
                  for (var i = 0; i < _providers.length; i++) ...[
                    if (i > 0) const SizedBox(height: 9),
                    _ProviderRow(
                      label: _providers[i].label,
                      brand: _providers[i].brand,
                      onTap: () => setState(() {
                        _providerNotice =
                            '${_providers[i].kind} sign-in isn’t connected '
                            'yet. Continue with your email below.';
                      }),
                    ),
                  ],
                  if (_providerNotice case final notice?) ...[
                    const SizedBox(height: 12),
                    _Notice(notice),
                  ],
                  const SizedBox(height: 22),
                  const _OrDivider(),
                  _EmailBody(isLogin: isLogin),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// One provider row — a silhouette glyph and a label on a frosted surface.
/// Honest: it is styled exactly as the approved design, and it does not
/// navigate anywhere, because nothing is wired behind it.
class _ProviderRow extends StatelessWidget {
  const _ProviderRow({
    required this.label,
    required this.brand,
    required this.onTap,
  });

  final String label;
  final AuthBrand brand;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return NexaPressable(
      onTap: onTap,
      scale: 0.978,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: BackdropFilter(
          filter: ui.ImageFilter.blur(sigmaX: 14, sigmaY: 14),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 15),
            decoration: BoxDecoration(
              color: c.isDark ? const Color(0x14FFFFFF) : const Color(0xB8FFFFFF),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: c.glassBorder, width: 1),
            ),
            child: Row(
              children: [
                SizedBox(
                  width: 20,
                  child: Center(
                    child: ProviderGlyph(brand: brand, size: 17, color: c.ink72),
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Text(
                    label,
                    style: NexaType.ui(
                      size: 14.5,
                      weight: FontWeight.w500,
                      color: c.ink86,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The honest inline line under the provider rows.
class _Notice extends StatelessWidget {
  const _Notice(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      decoration: BoxDecoration(
        color: c.surfaceQuiet,
        borderRadius: NexaRadius.cardAll,
        border: Border.all(color: c.hairlineStrong, width: 1),
      ),
      child: Text(
        text,
        style: NexaType.body(size: 12.5, color: c.ink50).copyWith(height: 1.5),
      ),
    );
  }
}

/// Email and password — the real authentication this build has, wired to
/// `AuthSessionRepository.signInWithPassword` / `.signUp`. Always visible
/// under the provider rows; [isLogin] decides which fields, which label and
/// which destination apply.
///
/// Owns its own controllers and state: leaving this screen and coming back
/// starts the form over, including the password field — nothing here should
/// linger in memory longer than the attempt using it.
class _EmailBody extends StatefulWidget {
  const _EmailBody({required this.isLogin});

  final bool isLogin;

  @override
  State<_EmailBody> createState() => _EmailBodyState();
}

class _EmailBodyState extends State<_EmailBody> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();

  bool _obscurePassword = true;
  bool _obscureConfirm = true;
  bool _submitting = false;

  String? _emailError;
  String? _passwordError;
  String? _confirmError;
  String? _formError;

  /// Set once a sign-up succeeds but the project requires confirming the
  /// address before a session exists — see `AuthSessionRepository.signUp`.
  bool _awaitingConfirmation = false;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  static bool _looksLikeEmail(String value) {
    final at = value.indexOf('@');
    return at > 0 && value.indexOf('.', at + 2) > at + 1 && !value.contains(' ');
  }

  bool _validate() {
    final email = _email.text.trim();
    final password = _password.text;

    setState(() {
      _emailError = email.isEmpty
          ? 'Email is required.'
          : _looksLikeEmail(email)
              ? null
              : "That doesn't look like an email address.";
      _passwordError = password.isEmpty ? 'Password is required.' : null;
      _confirmError = widget.isLogin || _confirm.text == password
          ? null
          : "Passwords don't match.";
    });

    return _emailError == null && _passwordError == null && _confirmError == null;
  }

  Future<void> _submit() async {
    if (_submitting) return;
    if (!_validate()) return;

    final state = NexaScope.of(context);
    final email = _email.text.trim();
    final password = _password.text;

    setState(() {
      _submitting = true;
      _formError = null;
    });

    try {
      if (widget.isLogin) {
        await state.authSession.signInWithPassword(
          email: email,
          password: password,
        );
        if (!mounted) return;
        state.setEmail(email);
        // Never assumed complete just because sign-in succeeded — this runs
        // the real profile check and routes to the assistant, to resuming
        // onboarding, or to a real error state accordingly.
        await state.routeAfterAuthentication();
        return;
      }

      final session = await state.authSession.signUp(
        email: email,
        password: password,
      );
      if (!mounted) return;
      if (session != null) {
        state.setEmail(email);
        // A fresh account meets Nexa before landing on the assistant.
        state.goRoot(NexaScreen.meeting);
        return;
      }
      setState(() => _awaitingConfirmation = true);
    } catch (error) {
      if (!mounted) return;
      setState(
        () => _formError = authErrorMessage(error, isSignUp: !widget.isLogin),
      );
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final state = NexaScope.of(context);

    if (_awaitingConfirmation) {
      return _ConfirmEmailNotice(email: _email.text.trim());
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 24),
        _BoxedField(
          label: 'Email',
          controller: _email,
          hint: 'you@example.com',
          keyboardType: TextInputType.emailAddress,
          error: _emailError != null,
        ),
        if (_emailError case final error?) _FieldError(error),
        const SizedBox(height: 18),
        _BoxedField(
          label: 'Password',
          controller: _password,
          hint: '••••••••',
          obscureText: _obscurePassword,
          error: _passwordError != null,
          onSubmitted: widget.isLogin ? (_) => _submit() : null,
          trailing: _VisibilityToggle(
            shown: !_obscurePassword,
            onTap: () => setState(() => _obscurePassword = !_obscurePassword),
          ),
        ),
        if (_passwordError case final error?) _FieldError(error),
        if (!widget.isLogin) ...[
          const SizedBox(height: 18),
          _BoxedField(
            label: 'Confirm password',
            controller: _confirm,
            hint: '••••••••',
            obscureText: _obscureConfirm,
            error: _confirmError != null,
            onSubmitted: (_) => _submit(),
            trailing: _VisibilityToggle(
              shown: !_obscureConfirm,
              onTap: () => setState(() => _obscureConfirm = !_obscureConfirm),
            ),
          ),
          if (_confirmError case final error?) _FieldError(error),
        ],
        if (_formError case final error?) ...[
          const SizedBox(height: 16),
          _FormErrorBanner(error),
        ],
        const SizedBox(height: 28),
        NexaPrimaryButton(
          label: _submitting
              ? (widget.isLogin ? 'Signing in…' : 'Creating account…')
              : (widget.isLogin ? 'Sign in' : 'Create account'),
          busy: _submitting,
          onTap: _submitting ? null : _submit,
        ),
        if (widget.isLogin) ...[
          const SizedBox(height: 10),
          Center(
            child: NexaQuietButton(
              label: 'Forgot password?',
              padding: 8,
              size: 13,
              color: c.ink45,
              onTap: () => state.go(NexaScreen.forgot),
            ),
          ),
        ],
        const SizedBox(height: 18),
        Center(
          child: NexaPressable(
            onTap: state.switchAuthScreen,
            scale: 0.99,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text: widget.isLogin
                          ? "Don't have an account? "
                          : 'Already have an account? ',
                      style: NexaType.ui(size: 13.5, color: c.ink42),
                    ),
                    TextSpan(
                      text: widget.isLogin ? 'Create account' : 'Sign in',
                      style: NexaType.ui(
                        size: 13.5,
                        weight: FontWeight.w500,
                        color: c.emerald,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// The boxed field the auth form uses — `--surface-quiet` fill, hairline
/// border, an emerald focus ring, an optional trailing control. The design's
/// own field shape here, rather than the underlined `NexaField` the rest of
/// the app uses for its one-line question screens.
class _BoxedField extends StatefulWidget {
  const _BoxedField({
    required this.label,
    required this.controller,
    this.hint,
    this.keyboardType,
    this.obscureText = false,
    this.error = false,
    this.onSubmitted,
    this.trailing,
  });

  final String label;
  final TextEditingController controller;
  final String? hint;
  final TextInputType? keyboardType;
  final bool obscureText;
  final bool error;
  final ValueChanged<String>? onSubmitted;
  final Widget? trailing;

  @override
  State<_BoxedField> createState() => _BoxedFieldState();
}

class _BoxedFieldState extends State<_BoxedField> {
  final _focus = FocusNode();

  @override
  void initState() {
    super.initState();
    _focus.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final focused = _focus.hasFocus;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          widget.label.toUpperCase(),
          style: NexaType.label(size: 10.5, tracking: 0.18, color: c.ink42),
        ),
        const SizedBox(height: 9),
        AnimatedContainer(
          duration: NexaMotion.fast,
          curve: NexaMotion.curve,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          decoration: BoxDecoration(
            color: widget.error
                ? c.danger.withValues(alpha: 0.07)
                : focused
                    ? c.emeraldWash
                    : c.surfaceQuiet,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: widget.error
                  ? c.danger.withValues(alpha: 0.5)
                  : focused
                      ? c.emeraldBorder
                      : c.hairlineStrong,
              width: 1,
            ),
          ),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: widget.controller,
                  focusNode: _focus,
                  keyboardType: widget.keyboardType,
                  obscureText: widget.obscureText,
                  onSubmitted: widget.onSubmitted,
                  style: NexaType.ui(size: 16, color: c.ink),
                  cursorColor: c.emerald,
                  cursorWidth: 1.5,
                  decoration: InputDecoration(
                    isCollapsed: true,
                    contentPadding: const EdgeInsets.symmetric(vertical: 15),
                    border: InputBorder.none,
                    hintText: widget.hint,
                    hintStyle: NexaType.ui(size: 16, color: c.ink30),
                  ),
                ),
              ),
              if (widget.trailing != null) widget.trailing!,
            ],
          ),
        ),
      ],
    );
  }
}

/// The bare-text "Show"/"Hide" a password field asks for — the app's own
/// idiom, not an eye icon.
class _VisibilityToggle extends StatelessWidget {
  const _VisibilityToggle({required this.shown, required this.onTap});

  final bool shown;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return NexaPressable(
      onTap: onTap,
      scale: 0.94,
      child: Padding(
        padding: const EdgeInsets.only(left: 10),
        child: Text(
          shown ? 'Hide' : 'Show',
          style: NexaType.ui(size: 13, color: c.ink50),
        ),
      ),
    );
  }
}

/// The small red line under a field once it has failed validation.
class _FieldError extends StatelessWidget {
  const _FieldError(this.message);

  final String message;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Text(
        message,
        style: NexaType.body(size: 12.5, color: c.danger),
      ),
    );
  }
}

/// The form-error banner — an icon, the message, on a danger wash.
class _FormErrorBanner extends StatelessWidget {
  const _FormErrorBanner(this.message);

  final String message;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return Container(
      padding: const EdgeInsets.fromLTRB(15, 13, 15, 13),
      decoration: BoxDecoration(
        color: c.danger.withValues(alpha: 0.09),
        borderRadius: NexaRadius.cardAll,
        border: Border.all(color: c.danger.withValues(alpha: 0.26), width: 1),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 1),
            child: Text('!', style: NexaType.ui(size: 14, color: c.danger)),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: NexaType.body(size: 13, color: c.danger).copyWith(height: 1.5),
            ),
          ),
        ],
      ),
    );
  }
}

/// Shown in place of the sign-up form once Supabase has accepted the account
/// but requires confirming the address before a session exists.
class _ConfirmEmailNotice extends StatelessWidget {
  const _ConfirmEmailNotice({required this.email});

  final String email;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final state = NexaScope.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 28),
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: c.emeraldWash,
            borderRadius: NexaRadius.glassAll,
            border: Border.all(color: c.emeraldBorder, width: 1),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                email.isEmpty
                    ? "We've sent a confirmation link to your email."
                    : "We've sent a confirmation link to $email.",
                style: NexaType.body(size: 14.5, color: c.ink86)
                    .copyWith(height: 1.6),
              ),
              const SizedBox(height: 9),
              Text(
                'Follow it to finish creating your account, then sign in below.',
                style: NexaType.body(size: 13, color: c.ink45)
                    .copyWith(height: 1.6),
              ),
            ],
          ),
        ),
        const SizedBox(height: 28),
        NexaPrimaryButton(
          label: 'Back to sign in',
          onTap: () => state.go(NexaScreen.login),
        ),
      ],
    );
  }
}

/// Password reset, wired to `AuthSessionRepository.requestPasswordReset`.
///
/// Supabase answers `/auth/v1/recover` the same way whether or not the
/// address has an account — deliberately, so the endpoint cannot be used to
/// learn which emails are registered. This shows the same confirmation
/// either way, for the same reason.
class _ForgotBody extends StatefulWidget {
  const _ForgotBody();

  @override
  State<_ForgotBody> createState() => _ForgotBodyState();
}

class _ForgotBodyState extends State<_ForgotBody> {
  final _email = TextEditingController();
  bool _submitting = false;
  bool _sent = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_submitting) return;
    final email = _email.text.trim();
    if (email.isEmpty) {
      setState(() => _error = 'Email is required.');
      return;
    }

    final state = NexaScope.of(context);
    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      await state.authSession.requestPasswordReset(email);
      if (!mounted) return;
      setState(() => _sent = true);
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = authErrorMessage(error, isSignUp: false));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final state = NexaScope.of(context);

    if (_sent) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 28),
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: c.emeraldWash,
              borderRadius: NexaRadius.glassAll,
              border: Border.all(color: c.emeraldBorder, width: 1),
            ),
            child: Text(
              "If an account exists for that email, we've sent a link to "
              'reset your password.',
              style: NexaType.body(size: 14, color: c.ink86)
                  .copyWith(height: 1.6),
            ),
          ),
          const SizedBox(height: 28),
          NexaPrimaryButton(
            label: 'Back to sign in',
            onTap: () => state.go(NexaScreen.login),
          ),
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 28),
        _BoxedField(
          label: 'Email',
          controller: _email,
          hint: 'you@example.com',
          keyboardType: TextInputType.emailAddress,
          error: _error != null,
          onSubmitted: (_) => _submit(),
        ),
        if (_error case final error?) _FieldError(error),
        const SizedBox(height: 28),
        NexaPrimaryButton(
          label: _submitting ? 'Sending…' : 'Send reset link',
          busy: _submitting,
          onTap: _submitting ? null : _submit,
        ),
      ],
    );
  }
}

/// A hairline, the words "or use email", a hairline.
class _OrDivider extends StatelessWidget {
  const _OrDivider();

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return Row(
      children: [
        Expanded(child: _Hairline(c)),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14),
          child: Text(
            'OR USE EMAIL',
            style: NexaType.label(size: 10.5, tracking: 0.18, color: c.ink32),
          ),
        ),
        Expanded(child: _Hairline(c)),
      ],
    );
  }
}

class _Hairline extends StatelessWidget {
  const _Hairline(this.c);

  final NexaPalette c;

  @override
  Widget build(BuildContext context) => SizedBox(
        height: 1,
        child: DecoratedBox(decoration: BoxDecoration(color: c.hairlineStrong)),
      );
}
