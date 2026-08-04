using System;
using UnityEngine;

namespace Nexa.Character.Locomotion
{
    /// <summary>
    /// Moves the companion through the real world.
    /// </summary>
    /// <remarks>
    /// The interface exists so that steering can be replaced with NavMesh-based navigation without
    /// touching the state machine that commands it. Steering ships first because runtime NavMesh
    /// baking over AR planes is expensive on mobile and unreliable during the first seconds of a
    /// scan, when planes are still merging and resizing — but obstacle-aware navigation is the
    /// required end state, so the seam is defined now rather than retrofitted.
    /// </remarks>
    public interface ICompanionLocomotion
    {
        bool IsMoving { get; }

        /// <summary>Travel speed as a fraction of maximum, 0 to 1. Feeds the animation blend.</summary>
        float NormalizedSpeed { get; }

        /// <summary>Turn rate as a signed fraction of maximum, -1 to 1.</summary>
        float NormalizedTurnRate { get; }

        /// <summary>True when the companion is standing on a known surface.</summary>
        bool IsGrounded { get; }

        /// <summary>
        /// Enables or disables keeping the companion glued to detected ground.
        /// </summary>
        /// <remarks>
        /// Disabled whenever the companion is parented to a platform anchor. The anchor is already
        /// the authority on where that real surface is, and the platform re-poses it every frame as
        /// it refines its map. A second system writing world Y on top of that fights those
        /// corrections and slowly drags the companion off the anchor it is supposed to be welded to.
        /// Re-enabled if the companion is ever detached to move under its own power.
        /// </remarks>
        void SetGroundAdherence(bool enabled);

        /// <summary>Commands the companion to walk to a world position.</summary>
        void MoveTo(Vector3 worldPosition);

        /// <summary>Halts immediately, cancelling any destination.</summary>
        void Stop();

        /// <summary>
        /// Teleports the companion. Used for initial placement and for re-anchoring after the XR
        /// session relocalises, where interpolating would drag the companion across the room.
        /// </summary>
        void Warp(Pose pose);

        /// <summary>Raised once when a commanded destination is reached.</summary>
        event Action DestinationReached;

        /// <summary>
        /// Advances motion. Driven explicitly by the owning controller rather than by Unity's
        /// <c>Update</c>, so that gaze, locomotion and animation always evaluate in a defined order
        /// within a frame instead of depending on script execution order settings.
        /// </summary>
        void Tick(float deltaTime);
    }
}
