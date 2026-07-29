using System;

namespace Nexa.Core.Spatial
{
    /// <summary>
    /// Semantic classification of a real-world surface, expressed independently of any
    /// specific XR provider (ARCore planes, ARKit planes, Android XR meshes, ...).
    /// </summary>
    /// <remarks>
    /// Declared as <see cref="FlagsAttribute"/> so that gameplay and configuration code can
    /// express *sets* of acceptable surfaces (e.g. "the companion may stand on Floor or Table")
    /// as a single serialized mask instead of a collection.
    /// </remarks>
    [Flags]
    public enum SurfaceType
    {
        None = 0,

        /// <summary>Horizontal, upward-facing, at or near room floor level.</summary>
        Floor = 1 << 0,

        /// <summary>Horizontal, upward-facing, raised above the floor (tables, counters, desks).</summary>
        Table = 1 << 1,

        /// <summary>Horizontal, downward-facing.</summary>
        Ceiling = 1 << 2,

        /// <summary>Vertical surface.</summary>
        Wall = 1 << 3,

        /// <summary>A seating surface (sofa, chair). Horizontal but not walkable.</summary>
        Seat = 1 << 4,

        Door = 1 << 5,
        Window = 1 << 6,

        /// <summary>Detected geometry the provider could not classify.</summary>
        Unclassified = 1 << 7,

        /// <summary>Every horizontal surface the companion could physically stand on.</summary>
        Walkable = Floor | Table,

        /// <summary>Any surface, classified or not.</summary>
        Any = ~0
    }
}
