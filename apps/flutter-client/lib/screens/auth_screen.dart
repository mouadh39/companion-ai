import 'package:flutter/widgets.dart';

import '../app_state.dart';
import '../theme/nexa_theme.dart';
import '../widgets/nexa_controls.dart';
import '../widgets/nexa_mark.dart';
import '../widgets/nexa_wordmark.dart';
import '../widgets/provider_glyphs.dart';

/// The identity providers the design offers, in order.
const _providers = <({String label, AuthBrand brand})>[
  (label: 'Continue with Google', brand: AuthBrand.google),
  (label: 'Continue with Apple', brand: AuthBrand.apple),
  (label: 'Continue with Meta', brand: AuthBrand.meta),
];

/// Sign up, log in, and password reset — one surface with four modes.
///
/// The design deliberately does not give these separate screens: the title and
/// the body swap, the chrome does not, so moving between them never feels like
/// a navigation.
class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key});

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final _phone = TextEditingController();
  final _email = TextEditingController();

  @override
  void dispose() {
    _phone.dispose();
    _email.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final state = NexaScope.of(context);
    final isForgot = state.screen == NexaScreen.forgot;
    final isLogin = state.screen == NexaScreen.login;
    final mode = isForgot ? null : state.authMode;

    final title = switch ((isForgot, mode)) {
      (true, _) => 'Reset your access.',
      (_, AuthMode.phone) => 'What is your number?',
      (_, AuthMode.passkey) => 'Use your passkey.',
      _ => isLogin ? 'Welcome back.' : 'Welcome to Nexa',
    };

    final subtitle = switch ((isForgot, mode)) {
      (true, _) => 'We will send a link to your email.',
      (_, AuthMode.phone) => 'A code, not a password.',
      (_, AuthMode.passkey) => 'No password, nothing to forget.',
      _ => "Explore what's next.",
    };

    // Signing in lands on the assistant; signing up meets Nexa first.
    void advance() => state.go(
      isForgot
          ? NexaScreen.login
          : isLogin
          ? NexaScreen.assistant
          : NexaScreen.meeting,
    );

    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: RadialGradient(
          center: Alignment(0, -1),
          radius: 1.1,
          colors: [c.groundTop, c.void_],
          stops: [0.0, 0.68],
        ),
      ),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(30, 58, 30, 40),
          child: ConstrainedBox(
            // Fill the frame so the footer can sit at the bottom on short
            // content and scroll away on long.
            constraints: BoxConstraints(
              // Clamped: on a very short viewport the subtraction would ask
              // for a negative height and the whole screen would throw.
              minHeight:
                  (MediaQuery.sizeOf(context).height - 98).clamp(0.0, 4000.0),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                NexaBackButton(
                  // Phone and passkey are sub-modes of this same surface, so
                  // back should return to the choice of method, not leave the
                  // screen altogether.
                  onTap: () => state.authMode == AuthMode.providers
                      ? state.go(NexaScreen.welcome)
                      : state.setAuthMode(AuthMode.providers),
                ),
                const SizedBox(height: 26),
                const Row(
                  children: [
                    NexaMark(
                      size: 34,
                      glow: 20,
                      glowOpacity: 0.35,
                    ),
                    SizedBox(width: 13),
                    NexaWordmark(size: 12, tracking: 0.5),
                  ],
                ),
                const SizedBox(height: 22),
                Text(title, style: NexaType.display(size: 29).copyWith(height: 1.16)),
                const SizedBox(height: 9),
                Text(
                  subtitle,
                  style: NexaType.body(size: 14.5, color: c.ink45),
                ),
                if (isForgot)
                  _ForgotBody(controller: _email, onSubmit: advance)
                else
                  switch (state.authMode) {
                    AuthMode.providers => _ProvidersBody(
                      isLogin: isLogin,
                      onProvider: advance,
                    ),
                    AuthMode.phone => _PhoneBody(
                      controller: _phone,
                      onSubmit: advance,
                    ),
                    AuthMode.passkey => _PasskeyBody(onSubmit: advance),
                  },
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The default: three providers, then the two methods that need no password.
class _ProvidersBody extends StatelessWidget {
  const _ProvidersBody({required this.isLogin, required this.onProvider});

  final bool isLogin;
  final VoidCallback onProvider;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final state = NexaScope.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 30),
        for (var i = 0; i < _providers.length; i++) ...[
          if (i > 0) const SizedBox(height: 10),
          NexaRiseIn(
            delay: NexaMotion.stagger * i,
            duration: const Duration(milliseconds: 500),
            distance: 14,
            child: NexaPillRow(
              label: _providers[i].label,
              labelWeight: FontWeight.w500,
              labelColor: c.ink90,
              fill: c.glassFill,
              border: c.glassBorder,
              onTap: onProvider,
              leading: _ProviderGlyph(brand: _providers[i].brand),
            ),
          ),
        ],
        const SizedBox(height: 22),
        const _OrDivider(),
        const SizedBox(height: 20),
        NexaPillRow(
          label: 'Continue with phone',
          trailing: '›',
          border: c.glassBorder,
          onTap: () => state.setAuthMode(AuthMode.phone),
        ),
        const SizedBox(height: 10),
        NexaPillRow(
          label: 'Use a passkey',
          labelWeight: FontWeight.w500,
          labelColor: c.emeraldBright,
          trailing: 'Fastest',
          trailingColor: const Color(0x8CA7F3D0),
          fill: const Color(0x174ADE9B),
          border: const Color(0x474ADE9B),
          onTap: () => state.setAuthMode(AuthMode.passkey),
        ),
        const SizedBox(height: 32),
        Text(
          "By continuing you agree to Nexa's terms and privacy notice.",
          textAlign: TextAlign.center,
          style: NexaType.body(size: 13, color: c.ink32)
              .copyWith(height: 1.6),
        ),
        const SizedBox(height: 16),
        Center(
          child: NexaPressable(
            onTap: state.toggleAuth,
            scale: 0.99,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text: isLogin ? 'New to Nexa? ' : 'Already with Nexa? ',
                      style: NexaType.ui(size: 13.5, color: c.ink42),
                    ),
                    TextSpan(
                      text: isLogin ? 'Create an account' : 'Log in',
                      style: NexaType.ui(size: 13.5, color: c.emerald),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
        if (isLogin) ...[
          const SizedBox(height: 4),
          Center(
            child: NexaQuietButton(
              label: 'Forgot password?',
              padding: 8,
              size: 13,
              color: c.ink36,
              onTap: () => state.go(NexaScreen.forgot),
            ),
          ),
        ],
      ],
    );
  }
}

/// A phone number and nothing else — the code arrives by text.
class _PhoneBody extends StatelessWidget {
  const _PhoneBody({required this.controller, required this.onSubmit});

  final TextEditingController controller;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final state = NexaScope.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 32),
        NexaField(
          controller: controller,
          prefix: '+1',
          hint: '(555) 000-0000',
          textSize: 22,
          keyboardType: TextInputType.phone,
          onSubmitted: (_) => onSubmit(),
        ),
        const SizedBox(height: 16),
        Text(
          "We'll text you a six-digit code. No password to remember.",
          style: NexaType.body(size: 13, color: c.ink36)
              .copyWith(height: 1.6),
        ),
        const SizedBox(height: 48),
        NexaPrimaryButton(label: 'Send code', trailing: '→', onTap: onSubmit),
        const SizedBox(height: 16),
        NexaQuietButton(
          label: 'More ways to continue',
          padding: 12,
          size: 13.5,
          color: c.ink40,
          onTap: () => state.setAuthMode(AuthMode.providers),
        ),
      ],
    );
  }
}

/// The passkey path — the device proves it is you, so there is nothing to type.
class _PasskeyBody extends StatelessWidget {
  const _PasskeyBody({required this.onSubmit});

  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final state = NexaScope.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 40),
        const Center(
          child: NexaMark(
            size: 118,
            glow: 44,
            glowOpacity: 0.5,
            breathe: Duration(seconds: 5),
            float: Duration(seconds: 12),
          ),
        ),
        const SizedBox(height: 26),
        Text(
          'Confirm with your device',
          textAlign: TextAlign.center,
          style: NexaType.ui(size: 21, color: c.ink, height: 1.3),
        ),
        const SizedBox(height: 10),
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 250),
            child: Text(
              "Nexa never stores a password. Your device proves it's you.",
              textAlign: TextAlign.center,
              style: NexaType.body(size: 14, color: c.ink45)
                  .copyWith(height: 1.6),
            ),
          ),
        ),
        const SizedBox(height: 48),
        NexaPrimaryButton(label: 'Continue', onTap: onSubmit),
        const SizedBox(height: 16),
        NexaQuietButton(
          label: 'Use another method',
          padding: 12,
          size: 13.5,
          color: c.ink40,
          onTap: () => state.setAuthMode(AuthMode.providers),
        ),
      ],
    );
  }
}

/// Password reset — one email field and a link out.
class _ForgotBody extends StatelessWidget {
  const _ForgotBody({required this.controller, required this.onSubmit});

  final TextEditingController controller;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 30),
        NexaField(
          label: 'Email',
          controller: controller,
          hint: 'you@example.com',
          textSize: 17,
          keyboardType: TextInputType.emailAddress,
          onSubmitted: (_) => onSubmit(),
        ),
        const SizedBox(height: 48),
        NexaPrimaryButton(label: 'Send reset link', onTap: onSubmit),
      ],
    );
  }
}

/// The square glyph tile in front of a provider's name. The tile is unchanged
/// from the design — only what sits inside it is a real mark now.
class _ProviderGlyph extends StatelessWidget {
  const _ProviderGlyph({required this.brand});

  final AuthBrand brand;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 22,
      height: 22,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: const Color(0xFF1F1F1F),
        borderRadius: BorderRadius.circular(6),
      ),
      child: ProviderGlyph(brand: brand),
    );
  }
}

/// A hairline, the word "or", a hairline.
class _OrDivider extends StatelessWidget {
  const _OrDivider();

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return Row(
      children: [
        const Expanded(child: _Hairline()),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14),
          child: Text(
            'OR',
            style: NexaType.label(
              size: 11,
              tracking: 0.18,
              color: c.ink30,
            ),
          ),
        ),
        const Expanded(child: _Hairline()),
      ],
    );
  }
}

class _Hairline extends StatelessWidget {
  const _Hairline();

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return SizedBox(
      height: 1,
      child: DecoratedBox(
        decoration: BoxDecoration(color: c.hairlineStrong),
      ),
    );
  }
}
