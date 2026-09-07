import 'dart:async';

import 'package:flutter/widgets.dart';

import '../../app_state.dart';
import '../../data/models/memory_entry.dart';
import '../../theme/nexa_theme.dart';
import '../../widgets/nexa_controls.dart';
import '../../widgets/nexa_glass.dart';
import '../../widgets/nexa_mark.dart';
import '../../widgets/nexa_page.dart';

/// What Nexa keeps about you.
///
/// The screen has one job beyond listing: to make the memory system legible.
/// The overview says how much she holds and how it is weighted, before a
/// single entry is read.
class MemoryScreen extends StatefulWidget {
  const MemoryScreen({super.key});

  @override
  State<MemoryScreen> createState() => _MemoryScreenState();
}

class _MemoryScreenState extends State<MemoryScreen> {
  /// The skeleton stands in for a fetch that does not exist yet. It belongs
  /// to the first arrival only — replaying it every time the tab is tapped
  /// would be latency the app invented for itself.
  static bool _hasLoadedOnce = false;

  late bool _loading = !_hasLoadedOnce;
  Timer? _load;

  @override
  void initState() {
    super.initState();
    // The local repository answers instantly; the real one will not, so the
    // screen is built around a load rather than around a list being there.
    if (!_loading) return;
    _load = Timer(const Duration(milliseconds: 420), () {
      _hasLoadedOnce = true;
      if (mounted) setState(() => _loading = false);
    });
  }

  @override
  void dispose() {
    _load?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = NexaScope.of(context);
    final repo = state.memoryRepository;
    final entries = repo.byFilter(state.memoryFilter);

    if (_loading) {
      return const NexaPage(
        title: 'Memory',
        subtitle: 'What Nexa keeps about you.',
        children: [_MemorySkeleton()],
      );
    }

    if (repo.count == 0) return const MemoryEmptyView();

    return NexaPage(
      title: 'Memory',
      subtitle: 'What Nexa keeps about you.',
      children: [
        _Overview(
          total: repo.count,
          important: repo.importantCount,
          people: repo.peopleCount,
        ),
        const SizedBox(height: 22),
        _Filters(
          selected: state.memoryFilter,
          onPick: state.setMemoryFilter,
        ),
        const SizedBox(height: 16),
        if (entries.isEmpty)
          const _NothingInFilter()
        else
          for (var i = 0; i < entries.length; i++) ...[
            if (i > 0) const SizedBox(height: 10),
            NexaRiseIn(
              delay: NexaMotion.stagger * (i < 6 ? i : 6),
              duration: const Duration(milliseconds: 460),
              distance: 12,
              child: _MemoryCard(
                entry: entries[i],
                onTap: () => state.openMemory(entries[i].id),
              ),
            ),
          ],
        const SizedBox(height: 20),
        NexaOutlineButton(
          label: 'Memory controls',
          onTap: () => state.go(NexaScreen.settingsMemory),
        ),
      ],
    );
  }
}

/// How much Nexa holds, before any of it is read.
class _Overview extends StatelessWidget {
  const _Overview({
    required this.total,
    required this.important,
    required this.people,
  });

  final int total;
  final int important;
  final int people;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return NexaGlassSurface(
      blur: 18,
      tint: c.emeraldWash,
      borderColor: c.emeraldBorder,
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'SHE REMEMBERS',
            style: NexaType.label(size: 10, color: c.ink36),
          ),
          const SizedBox(height: 12),
          // A Row with fixed gaps overflowed once the reader turned type up.
          // Wrap lays out identically at the default size and gives way
          // instead of breaking at larger ones.
          Wrap(
            spacing: 26,
            runSpacing: 14,
            crossAxisAlignment: WrapCrossAlignment.end,
            children: [
              _Stat(value: '$total', label: 'things'),
              _Stat(value: '$important', label: 'weighted'),
              _Stat(value: '$people', label: 'people'),
            ],
          ),
          const SizedBox(height: 14),
          Text(
            'Everything here came from something you said. Correct any of it '
            'and she follows the correction.',
            style: NexaType.body(size: 12.5, color: c.ink45)
                .copyWith(height: 1.55),
          ),
        ],
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.value, required this.label});

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          value,
          style: NexaType.ui(size: 21, color: c.emeraldBright),
        ),
        const SizedBox(height: 3),
        Text(label, style: NexaType.ui(size: 11, color: c.ink36)),
      ],
    );
  }
}

class _Filters extends StatelessWidget {
  const _Filters({required this.selected, required this.onPick});

  final MemoryFilter selected;
  final ValueChanged<MemoryFilter> onPick;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return Wrap(
      spacing: 7,
      runSpacing: 7,
      children: [
        for (final f in MemoryFilter.values)
          NexaPressable(
            onTap: () => onPick(f),
            scale: 0.96,
            child: AnimatedContainer(
              duration: NexaMotion.fast,
              padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 9),
              decoration: BoxDecoration(
                color: f == selected
                    ? const Color(0x1F4ADE9B)
                    : c.surfaceQuiet,
                borderRadius: NexaRadius.pillAll,
                border: Border.all(
                  color: f == selected
                      ? c.emeraldBorder
                      : c.hairline,
                  width: 1,
                ),
              ),
              child: Text(
                f.label,
                style: NexaType.ui(
                  size: 12.5,
                  color: f == selected
                      ? c.emeraldBright
                      : c.ink72,
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _MemoryCard extends StatelessWidget {
  const _MemoryCard({required this.entry, required this.onTap});

  final MemoryEntry entry;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return NexaGlassCard(
      onTap: onTap,
      blur: 12,
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 18),
      borderColor: entry.important ? const Color(0x2E4ADE9B) : c.glassBorder,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            entry.text,
            style: NexaType.ui(
              size: 15.5,
              color: c.ink86,
              height: 1.5,
            ),
          ),
          const SizedBox(height: 11),
          Row(
            children: [
              NexaStatusDot(
                color: entry.important
                    ? c.emerald
                    : c.ink30,
                glow: entry.important,
              ),
              const SizedBox(width: 9),
              Text(
                '${entry.when} · ${entry.kind.label}',
                style: NexaType.ui(size: 11.5, color: c.ink34),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _NothingInFilter extends StatelessWidget {
  const _NothingInFilter();

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return NexaGlassSurface(
      blur: 14,
      padding: const EdgeInsets.symmetric(vertical: 44, horizontal: 20),
      child: Center(
        child: Text(
          'Nothing of this kind yet.',
          style: NexaType.body(size: 14, color: c.ink42),
        ),
      ),
    );
  }
}

/// The loading state. Shapes, not spinners — the page keeps its rhythm while
/// the data arrives. The whole stack breathes on one slow opacity cycle
/// (the reference's `nx-shimmer`), held still under reduced motion.
class _MemorySkeleton extends StatefulWidget {
  const _MemorySkeleton();

  @override
  State<_MemorySkeleton> createState() => _MemorySkeletonState();
}

class _MemorySkeletonState extends State<_MemorySkeleton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1500),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (NexaColors.reducedMotion(context)) {
      _c.stop();
      _c.value = 0;
    } else if (!_c.isAnimating) {
      _c.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final content = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _bar(c, height: 132, radius: 20),
        const SizedBox(height: 22),
        Row(
          children: [
            _bar(c, height: 34, radius: 999, width: 84),
            const SizedBox(width: 7),
            _bar(c, height: 34, radius: 999, width: 92),
            const SizedBox(width: 7),
            _bar(c, height: 34, radius: 999, width: 78),
          ],
        ),
        const SizedBox(height: 16),
        for (var i = 0; i < 4; i++) ...[
          if (i > 0) const SizedBox(height: 10),
          _bar(c, height: 96, radius: 20),
        ],
      ],
    );

    return AnimatedBuilder(
      animation: _c,
      builder: (context, child) => Opacity(
        opacity: 0.55 + 0.45 * (1 - _c.value),
        child: child,
      ),
      child: content,
    );
  }

  Widget _bar(
    NexaPalette c, {
    required double height,
    required double radius,
    double? width,
  }) {
    return Container(
      height: height,
      width: width,
      decoration: BoxDecoration(
        color: c.surfaceQuiet,
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(color: c.hairline, width: 1),
      ),
    );
  }
}

/// Nothing kept yet — either a new account, or everything was forgotten.
class MemoryEmptyView extends StatelessWidget {
  const MemoryEmptyView({super.key});

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final state = NexaScope.of(context);

    return NexaAtmosphere(
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(32, 56, 32, 130),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Memory', style: NexaType.display(size: 27)),
              Expanded(
                child: Center(
                  child: NexaGlassSurface(
                    blur: 20,
                    padding: const EdgeInsets.symmetric(
                      vertical: 40,
                      horizontal: 30,
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        NexaMark(
                          size: 96,
                          material: c.isDark
                              ? NexaMarkMaterial.graphite
                              : NexaMarkMaterial.stealthBlack,
                          glow: 0,
                          glowOpacity: 0,
                          breathe: const Duration(seconds: 9),
                          opacity: c.isDark ? 0.55 : 0.62,
                        ),
                        const SizedBox(height: 30),
                        Text(
                          "Nexa hasn't remembered anything yet.",
                          textAlign: TextAlign.center,
                          style: NexaType.display(size: 24),
                        ),
                        const SizedBox(height: 12),
                        ConstrainedBox(
                          constraints: const BoxConstraints(maxWidth: 250),
                          child: Text(
                            'Nexa will remember what matters as you start '
                            'talking.',
                            textAlign: TextAlign.center,
                            style: NexaType.body(
                              size: 14.5,
                              color: c.ink45,
                            ).copyWith(height: 1.6),
                          ),
                        ),
                        const SizedBox(height: 28),
                        NexaEmeraldButton(
                          label: 'Talk to Nexa',
                          onTap: () => state.goTab(NexaTab.nexa),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
