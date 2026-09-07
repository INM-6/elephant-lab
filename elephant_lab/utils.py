"""
Shared helper functions used across elephant lab for unit handling, value
formatting, and downsampling of numeric arrays for display.
"""

class OutputUtils:
    """Static helper methods for converting units, formatting numbers, and downsampling data."""

    import quantities as pq
    import numpy as np
    import sys

    UNIT_TO_LABEL_DICT = {
        pq.dimensionless: "",

        pq.s.simplified.dimensionality: "Time",
        pq.m.simplified.dimensionality: "Length",
        pq.kg.simplified.dimensionality: "Mass",
        pq.A.simplified.dimensionality: "Current",
        pq.K.simplified.dimensionality: "Temperature",
        pq.mol.simplified.dimensionality: "Substance",
        pq.cd.simplified.dimensionality: "Luminous Intensity",

        pq.Hz.simplified.dimensionality: "Frequency",
        (pq.m / pq.s).simplified.dimensionality: "Velocity",
        (pq.m / pq.s**2).simplified.dimensionality: "Acceleration",
        pq.N.simplified.dimensionality: "Force",
        pq.J.simplified.dimensionality: "Energy",
        pq.Pa.simplified.dimensionality: "Pressure",
        pq.W.simplified.dimensionality: "Power",
        pq.C.simplified.dimensionality: "Electric Charge",
        pq.V.simplified.dimensionality: "Voltage",
        pq.Ohm.simplified.dimensionality: "Resistance",
        pq.F.simplified.dimensionality: "Capacitance",
        pq.H.simplified.dimensionality: "Inductance",
        pq.T.simplified.dimensionality: "Magnetic Flux Density",
        pq.Wb.simplified.dimensionality: "Magnetic Flux",
        # overrides dimensionless wich is more commonly used than using a solid angle and there is no simple way to find out what excactly the user wanted
        #pq.sr.simplified.dimensionality: "Solid Angle",
        pq.B.simplified.dimensionality: "Bel",
        (pq.kg * pq.m / pq.s).simplified.dimensionality: "Momentum",
        (pq.N * pq.m).simplified.dimensionality: "Torque",
        (pq.W / pq.m**2).simplified.dimensionality: "Irradiance",
        (pq.J / pq.K).simplified.dimensionality: "Entropy",
    }

    @staticmethod
    def can_convert_units(unit, convert_unit):
        """
        Returns 0 if no conversion is needed
        Returns -1 if it is not possible to convert
        Returns 1 if it can be converted
        """
        if unit == convert_unit:
            return 0
        if unit.simplified.dimensionality != convert_unit.simplified.dimensionality:
            return -1
        return 1

    @staticmethod
    def get_conversion_factor(unit, convert_unit):
        q = OutputUtils.pq.Quantity(1,unit)
        return q.rescale(convert_unit).magnitude
        
    @staticmethod
    def convert_to_other_units(val, unit, convert_unit):
        """Rescales a value from unit to convert_unit and returns the raw magnitude."""
        q = OutputUtils.pq.Quantity(val, unit)
        return q.rescale(convert_unit).magnitude

    
    @staticmethod
    def get_text_label(unit):
        """Returns a human-readable physical quantity name (e.g. 'Frequency') for a quantities unit."""
        pq = OutputUtils.pq

        def simplify(unit):
            if unit == pq.dimensionless:
                return pq.dimensionless
            return unit.simplified.dimensionality

        unit_key = simplify(unit)
        if unit_key in OutputUtils.UNIT_TO_LABEL_DICT:
            return OutputUtils.UNIT_TO_LABEL_DICT[unit_key]
        else:
            return ""
    
    @staticmethod
    def convert_unit_to_label(unit, short=False):
        """Formats a unit as a display label, either short ('s') or long ('Time(s)')."""
        if unit is None:
            return ""

        if short:
            return str(unit.dimensionality) if unit != OutputUtils.pq.dimensionless else ""
        else:
            return f"{OutputUtils.get_text_label(unit)}({unit.dimensionality})"

    @staticmethod
    def center_text_for_length(text, length):
        """
        Centers text by adding a character to the start
        that does not get trimmed and then the fitting
        number of spaces to center it to the desired length.
        Should ONLY be used, if there is no clean way of doing
        it with CSS or a property that would center it!
        """
        text = str(text)
        if len(text) >= length:
            return text
        padding = (length - len(text)) // 2
        return "\u2060" + " " * padding + text
    
    @staticmethod
    def format_with_auto_digits(values):
        """
        Fully vectorized formatting of values with automatic per-value decimal digits.
        Handles zeros, NaN, and inf without warnings.
        """
        np = OutputUtils.np
        abs_xs = np.abs(values)

        # Replace zeros, NaN, and inf with 1 for log10
        safe_xs = np.where(np.isfinite(abs_xs) & (abs_xs != 0), abs_xs, 1.0)

        # Compute digits, clip to [0,6]
        digits = np.clip(2 - np.floor(np.log10(safe_xs)), 0, 6).astype(int)

        # NaN/inf get 0 digits
        digits[~np.isfinite(abs_xs)] = 0

        # Cast digits and values to Python types for np.char.mod
        digits_py = digits.astype(int).tolist()
        values_py = values.astype(float).tolist()

        # Use np.char.mod with Python ints
        formatted = np.array([
            f"{v:.{d}f}" if np.isfinite(v) else ("nan" if np.isnan(v) else "inf")
            for v, d in zip(values_py, digits_py)
        ])

        return formatted
    
    @staticmethod
    def print_warning(message):
        """Currently a no-op placeholder for emitting warnings; kept as a single call site."""
        pass
        #print(f"WARNING: {message}", file=PlotlyUtils.sys.stderr)

    @staticmethod
    def normalize(values, method="minmax"):
        """
        Normalizes an array of values using "minmax", "zscore", or "l2" scaling.
        """
        np = OutputUtils.np
        values = np.asarray(values)
        if not np.issubdtype(values.dtype, np.floating):
            values = values.astype(float)
        
        eps = np.finfo(values.dtype).eps

        method = method.lower()
        if method == "minmax":
            vmin = np.nanmin(values)
            vmax = np.nanmax(values)
            denom = vmax - vmin

            # Stricter check: already normalized to [0,1]
            if denom > eps and np.isclose(vmin, 0, atol=eps) and np.isclose(vmax, 1, atol=eps):
                return lambda val : val

            def normalize(val):
                val -= vmin
                val /= denom
                return val
            return normalize if denom > eps else lambda val: np.zeros_like(val)

        elif method == "zscore":
            mean = np.nanmean(values)
            std = np.nanstd(values)

            # Already standardized (mean≈0, std≈1)
            if std > eps and np.isclose(mean, 0, atol=eps) and np.isclose(std, 1, atol=eps):
                return lambda val : val

            def normalize(val):
                val -= mean
                val /= std
                return val
            return normalize if std > eps else lambda val: np.zeros_like(val)

        elif method == "l2":
            norm = np.linalg.norm(values)

            # Already unit norm
            if norm > eps and np.isclose(norm, 1, atol=eps):
                return lambda val : val

            def normalize(val):
                val /= norm
                return val
            return normalize if norm > eps else lambda val: np.zeros_like(val)

        else:
            raise ValueError(f"Unknown normalization method: {method}")