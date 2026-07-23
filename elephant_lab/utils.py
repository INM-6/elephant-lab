class OutputUtils:
    import quantities as pq
    import numpy as np
    import sys

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
    def convert_to_other_units(val, unit, convert_unit):
        q = OutputUtils.pq.Quantity(val, unit)
        return q.rescale(convert_unit).magnitude
    
    @staticmethod
    def get_text_label(unit):
        pq = OutputUtils.pq
        def simplify(unit):
            if unit == pq.dimensionless:
                return pq.dimensionless
            return unit.simplified.dimensionality

        unit_to_label = {
            simplify(pq.dimensionless): "",

            simplify(pq.s): "Time",
            simplify(pq.m): "Length",
            simplify(pq.kg): "Mass",
            simplify(pq.A): "Current",
            simplify(pq.K): "Temperature",
            simplify(pq.mol): "Substance",
            simplify(pq.cd): "Luminous Intensity",

            simplify(pq.Hz): "Frequency",
            simplify((pq.m / pq.s)): "Velocity",
            simplify((pq.m / pq.s**2)): "Acceleration",
            simplify(pq.N): "Force",
            simplify(pq.J): "Energy",
            simplify(pq.Pa): "Pressure",
            simplify(pq.W): "Power",
            simplify(pq.C): "Electric Charge",
            simplify(pq.V): "Voltage",
            simplify(pq.Ohm): "Resistance",
            simplify(pq.F): "Capacitance",
            simplify(pq.H): "Inductance",
            simplify(pq.T): "Magnetic Flux Density",
            simplify(pq.Wb): "Magnetic Flux",
            # overrides dimensionless wich is more commonly used than using a solid angle and there is no simple way to find out what excactly the user wanted
            #simplify(pq.sr): "Solid Angle",
            simplify(pq.B): "Bel",
            simplify(pq.kg * pq.m / pq.s): "Momentum",
            simplify(pq.N * pq.m): "Torque",
            simplify(pq.W / pq.m**2): "Irradiance",
            simplify(pq.J / pq.K): "Entropy",
        }

        unit_key = simplify(unit)
        if unit_key in unit_to_label:
            return unit_to_label[unit_key]
        else:
            return ""
    
    @staticmethod
    def convert_unit_to_label(unit, short=False):
        if unit is None:
            return ""

        if short:
            return str(unit.dimensionality) if unit != OutputUtils.pq.dimensionless else ""
        else:
            return f"{OutputUtils.get_text_label(unit)}({unit.dimensionality})"

    @staticmethod
    def center_text_for_length(text, length):
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
        pass
        #print(f"WARNING: {message}", file=PlotlyUtils.sys.stderr)

    @staticmethod
    def normalize(values, method="minmax"):
        np = OutputUtils.np
        values = np.asarray(values, dtype=float)
        
        eps = np.finfo(values.dtype).eps

        method = method.lower()
        if method == "minmax":
            vmin = np.nanmin(values)
            vmax = np.nanmax(values)
            denom = vmax - vmin

            # Stricter check: already normalized to [0,1]
            if denom > eps and np.isclose(vmin, 0, atol=eps) and np.isclose(vmax, 1, atol=eps):
                return values

            return (values - vmin) / denom if denom > eps else np.zeros_like(values)

        elif method == "zscore":
            mean = np.nanmean(values)
            std = np.nanstd(values)

            # Already standardized (mean≈0, std≈1)
            if std > eps and np.isclose(mean, 0, atol=eps) and np.isclose(std, 1, atol=eps):
                return values

            return (values - mean) / std if std > eps else np.zeros_like(values)

        elif method == "l2":
            norm = np.linalg.norm(values)

            # Already unit norm
            if norm > eps and np.isclose(norm, 1, atol=eps):
                return values, True

            return values / norm if norm > eps else np.zeros_like(values)

        else:
            raise ValueError(f"Unknown normalization method: {method}")