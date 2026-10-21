<?php
/**
 * Minimal Excel (XLSX) writer built for this plugin: no external dependencies, low memory use.
 *
 * Supports what the attendance sheet needs: several worksheets, numbers and text, fonts (size, bold),
 * solid fills, thin borders, alignment and wrapped text, merged cells, column widths, row heights,
 * frozen panes and landscape A4 printing fitted to the page width.
 * The file is a ZIP of XML parts (ZipArchive, or the PclZip library bundled with WordPress).
 *
 * Usage:
 *   $x = new Dolly_Xlsx();
 *   $s = $x->add_sheet( 'Sede' );
 *   $x->set( $s, 1, 2, 'Anno', array( 'bold' => true ) );   // row 1, column 2 (B1)
 *   $path = $x->save();                                        // temporary file path or WP_Error
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;

class Dolly_Xlsx {

	const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

	const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
	const NS_REL  = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

	/** @var array[] Worksheets: name, cells [row][col] => [value, style index], merges, widths, heights, freeze. */
	private $sheets = array();

	/** Style registries: serialised definition => index. Index 0 of each is the Excel default. */
	private $fonts   = array();
	private $fills   = array();
	private $xfs     = array();
	private $font_xml = array();
	private $fill_xml = array();
	private $xf_xml   = array();

	public function __construct() {
		// Defaults required by Excel: font 0, fills 0 (none) and 1 (gray125), cell format 0.
		$this->font( 10, false, '' );
		$this->fill_xml[] = '<fill><patternFill patternType="none"/></fill>';
		$this->fill_xml[] = '<fill><patternFill patternType="gray125"/></fill>';
		$this->xf_xml[]   = '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>';
		$this->xfs['default'] = 0;
	}

	/* ---------- Building ---------- */

	/** Adds a worksheet and returns its index. */
	public function add_sheet( $name ) {
		$this->sheets[] = array(
			'name'    => $this->sheet_name( $name ),
			'cells'   => array(),
			'merges'  => array(),
			'widths'  => array(),
			'heights' => array(),
			'freeze'  => null,
		);
		return count( $this->sheets ) - 1;
	}

	/** Excel sheet names: at most 31 characters, none of []:*?/\, unique in the workbook. */
	private function sheet_name( $name ) {
		$name = trim( preg_replace( '/[\[\]\:\*\?\/\\\\]+/', ' ', (string) $name ) );
		$name = trim( $name, "' " ); // A name cannot start or end with an apostrophe.
		$name = '' === $name ? __( 'Foglio', 'dolly-employee-management' ) : $name;
		$base = function_exists( 'mb_substr' ) ? mb_substr( $name, 0, 31 ) : substr( $name, 0, 31 );
		$used = array();
		foreach ( $this->sheets as $s ) {
			$used[ strtolower( $s['name'] ) ] = true;
		}
		$candidate = $base;
		$i         = 2;
		while ( isset( $used[ strtolower( $candidate ) ] ) ) {
			$suffix    = ' (' . $i++ . ')';
			$candidate = ( function_exists( 'mb_substr' ) ? mb_substr( $base, 0, 31 - strlen( $suffix ) ) : substr( $base, 0, 31 - strlen( $suffix ) ) ) . $suffix;
		}
		return $candidate;
	}

	/**
	 * Writes a cell. $row and $col are 1-based. A null or empty value writes an empty, styled cell.
	 *
	 * @param array $style bold, size, color (RRGGBB), fill (RRGGBB), border (bool),
	 *                     align (left|center|right), valign (top|center|bottom), wrap (bool)
	 */
	public function set( $sheet, $row, $col, $value, array $style = array() ) {
		$this->sheets[ $sheet ]['cells'][ (int) $row ][ (int) $col ] = array( $value, $this->style( $style ) );
	}

	/** Applies a style to every cell of a range, keeping the values already written. */
	public function style_range( $sheet, $r1, $c1, $r2, $c2, array $style ) {
		$s = $this->style( $style );
		for ( $r = $r1; $r <= $r2; $r++ ) {
			for ( $c = $c1; $c <= $c2; $c++ ) {
				$v = isset( $this->sheets[ $sheet ]['cells'][ $r ][ $c ] ) ? $this->sheets[ $sheet ]['cells'][ $r ][ $c ][0] : null;
				$this->sheets[ $sheet ]['cells'][ $r ][ $c ] = array( $v, $s );
			}
		}
	}

	public function merge( $sheet, $r1, $c1, $r2, $c2 ) {
		if ( $r1 === $r2 && $c1 === $c2 ) {
			return;
		}
		$this->sheets[ $sheet ]['merges'][] = self::ref( $r1, $c1 ) . ':' . self::ref( $r2, $c2 );
	}

	/** Column width in characters of the default font. */
	public function width( $sheet, $col, $width ) {
		$this->sheets[ $sheet ]['widths'][ (int) $col ] = (float) $width;
	}

	/** Row height in points. */
	public function height( $sheet, $row, $points ) {
		$this->sheets[ $sheet ]['heights'][ (int) $row ] = (float) $points;
	}

	/** Keeps the first $cols columns and $rows rows visible while scrolling. */
	public function freeze( $sheet, $cols, $rows ) {
		$this->sheets[ $sheet ]['freeze'] = array( (int) $cols, (int) $rows );
	}

	/* ---------- Styles ---------- */

	private function font( $size, $bold, $color ) {
		$key = $size . '|' . ( $bold ? 1 : 0 ) . '|' . $color;
		if ( ! isset( $this->fonts[ $key ] ) ) {
			$this->fonts[ $key ] = count( $this->font_xml );
			$this->font_xml[]    = '<font>' . ( $bold ? '<b/>' : '' ) . '<sz val="' . self::num( $size ) . '"/>'
				. ( $color ? '<color rgb="FF' . $color . '"/>' : '' ) . '<name val="Arial"/><family val="2"/></font>';
		}
		return $this->fonts[ $key ];
	}

	private function fill( $color ) {
		if ( ! $color ) {
			return 0;
		}
		if ( ! isset( $this->fills[ $color ] ) ) {
			$this->fills[ $color ] = count( $this->fill_xml );
			$this->fill_xml[]      = '<fill><patternFill patternType="solid"><fgColor rgb="FF' . $color . '"/><bgColor indexed="64"/></patternFill></fill>';
		}
		return $this->fills[ $color ];
	}

	private static function hex( $color ) {
		$color = strtoupper( ltrim( (string) $color, '#' ) );
		return preg_match( '/^[0-9A-F]{6}$/', $color ) ? $color : '';
	}

	/** Returns the cell format index of a style definition (created on first use). */
	private function style( array $style ) {
		if ( ! $style ) {
			return 0;
		}
		$def = array(
			'size'   => isset( $style['size'] ) ? (float) $style['size'] : 10,
			'bold'   => ! empty( $style['bold'] ),
			'color'  => self::hex( $style['color'] ?? '' ),
			'fill'   => self::hex( $style['fill'] ?? '' ),
			'border' => ! empty( $style['border'] ),
			'align'  => in_array( $style['align'] ?? '', array( 'left', 'center', 'right' ), true ) ? $style['align'] : '',
			'valign' => in_array( $style['valign'] ?? '', array( 'top', 'center', 'bottom' ), true ) ? $style['valign'] : '',
			'wrap'   => ! empty( $style['wrap'] ),
		);
		$key = implode( '|', $def );
		if ( isset( $this->xfs[ $key ] ) ) {
			return $this->xfs[ $key ];
		}
		$font   = $this->font( $def['size'], $def['bold'], $def['color'] );
		$fill   = $this->fill( $def['fill'] );
		$border = $def['border'] ? 1 : 0;
		$align  = '';
		if ( $def['align'] || $def['valign'] || $def['wrap'] ) {
			$align = '<alignment' . ( $def['align'] ? ' horizontal="' . $def['align'] . '"' : '' )
				. ( $def['valign'] ? ' vertical="' . $def['valign'] . '"' : '' )
				. ( $def['wrap'] ? ' wrapText="1"' : '' ) . '/>';
		}
		$xml = '<xf numFmtId="0" fontId="' . $font . '" fillId="' . $fill . '" borderId="' . $border . '" xfId="0"'
			. ( $font ? ' applyFont="1"' : '' ) . ( $fill ? ' applyFill="1"' : '' ) . ( $border ? ' applyBorder="1"' : '' )
			. ( $align ? ' applyAlignment="1">' . $align . '</xf>' : '/>' );
		$this->xfs[ $key ] = count( $this->xf_xml );
		$this->xf_xml[]    = $xml;
		return $this->xfs[ $key ];
	}

	/* ---------- XML ---------- */

	/** Column letters: 1 → A, 27 → AA. */
	public static function col( $n ) {
		$s = '';
		$n = (int) $n;
		while ( $n > 0 ) {
			$m = ( $n - 1 ) % 26;
			$s = chr( 65 + $m ) . $s;
			$n = (int) ( ( $n - $m - 1 ) / 26 );
		}
		return $s;
	}

	public static function ref( $row, $col ) {
		return self::col( $col ) . (int) $row;
	}

	/** Number written with a dot, whatever the server locale (a comma would corrupt the file). */
	private static function num( $n ) {
		if ( is_int( $n ) ) {
			return (string) $n;
		}
		$s = number_format( (float) $n, 4, '.', '' );
		return false !== strpos( $s, '.' ) ? rtrim( rtrim( $s, '0' ), '.' ) : $s;
	}

	/** Text safe for XML 1.0 (control characters are not allowed in a worksheet). */
	private static function esc( $text ) {
		$text  = wp_check_invalid_utf8( (string) $text, true );
		$clean = preg_replace( '/[^\x{9}\x{A}\x{D}\x{20}-\x{D7FF}\x{E000}-\x{FFFD}\x{10000}-\x{10FFFF}]/u', '', $text );
		return htmlspecialchars( null === $clean ? $text : $clean, ENT_QUOTES | ENT_XML1, 'UTF-8' );
	}

	private static function head() {
		return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' . "\n";
	}

	private function styles_xml() {
		return self::head() . '<styleSheet xmlns="' . self::NS_MAIN . '">'
			. '<fonts count="' . count( $this->font_xml ) . '">' . implode( '', $this->font_xml ) . '</fonts>'
			. '<fills count="' . count( $this->fill_xml ) . '">' . implode( '', $this->fill_xml ) . '</fills>'
			. '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'
			. '<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>'
			. '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
			. '<cellXfs count="' . count( $this->xf_xml ) . '">' . implode( '', $this->xf_xml ) . '</cellXfs>'
			. '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
			. '</styleSheet>';
	}

	private function sheet_xml( array $sheet ) {
		// Rows that only have a height are written too.
		foreach ( array_keys( $sheet['heights'] ) as $r ) {
			if ( ! isset( $sheet['cells'][ $r ] ) ) {
				$sheet['cells'][ $r ] = array();
			}
		}
		ksort( $sheet['cells'] );
		$max_row = 1;
		$max_col = 1;
		$rows    = '';
		foreach ( $sheet['cells'] as $r => $cells ) {
			ksort( $cells );
			$max_row = max( $max_row, $r );
			$xml     = '';
			foreach ( $cells as $c => $cell ) {
				$max_col              = max( $max_col, $c );
				list( $value, $style ) = $cell;
				$attr                 = ' r="' . self::ref( $r, $c ) . '"' . ( $style ? ' s="' . $style . '"' : '' );
				if ( null === $value || '' === $value ) {
					$xml .= '<c' . $attr . '/>';
				} elseif ( is_int( $value ) || is_float( $value ) ) {
					$xml .= '<c' . $attr . '><v>' . self::num( $value ) . '</v></c>';
				} else {
					$xml .= '<c' . $attr . ' t="inlineStr"><is><t xml:space="preserve">' . self::esc( $value ) . '</t></is></c>';
				}
			}
			$ht    = isset( $sheet['heights'][ $r ] ) ? ' ht="' . number_format( $sheet['heights'][ $r ], 2, '.', '' ) . '" customHeight="1"' : '';
			$rows .= '<row r="' . $r . '"' . $ht . '>' . $xml . '</row>';
		}
		$cols = '';
		if ( $sheet['widths'] ) {
			ksort( $sheet['widths'] );
			foreach ( $sheet['widths'] as $c => $w ) {
				$cols .= '<col min="' . $c . '" max="' . $c . '" width="' . number_format( $w, 2, '.', '' ) . '" customWidth="1"/>';
			}
			$cols = '<cols>' . $cols . '</cols>';
		}
		$view = '<sheetView workbookViewId="0"/>';
		if ( $sheet['freeze'] && ( $sheet['freeze'][0] || $sheet['freeze'][1] ) ) {
			list( $fc, $fr ) = $sheet['freeze'];
			$pane            = $fc && $fr ? 'bottomRight' : ( $fc ? 'topRight' : 'bottomLeft' );
			$view            = '<sheetView workbookViewId="0"><pane' . ( $fc ? ' xSplit="' . $fc . '"' : '' ) . ( $fr ? ' ySplit="' . $fr . '"' : '' )
				. ' topLeftCell="' . self::ref( $fr + 1, $fc + 1 ) . '" activePane="' . $pane . '" state="frozen"/>'
				. '<selection pane="' . $pane . '"/></sheetView>';
		}
		$merges = '';
		if ( $sheet['merges'] ) {
			foreach ( $sheet['merges'] as $m ) {
				$merges .= '<mergeCell ref="' . $m . '"/>';
			}
			$merges = '<mergeCells count="' . count( $sheet['merges'] ) . '">' . $merges . '</mergeCells>';
		}
		// The order of the elements is fixed by the file format.
		return self::head() . '<worksheet xmlns="' . self::NS_MAIN . '" xmlns:r="' . self::NS_REL . '">'
			. '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
			. '<dimension ref="A1:' . self::ref( $max_row, $max_col ) . '"/>'
			. '<sheetViews>' . $view . '</sheetViews>'
			. '<sheetFormatPr defaultRowHeight="13.2"/>'
			. $cols
			. '<sheetData>' . $rows . '</sheetData>'
			. $merges
			. '<pageMargins left="0.39" right="0.39" top="0.59" bottom="0.59" header="0.3" footer="0.3"/>'
			. '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>'
			. '</worksheet>';
	}

	/** All the parts of the package: path inside the ZIP => content. */
	private function parts() {
		$n        = count( $this->sheets );
		$types    = '';
		$sheets   = '';
		$rels     = '';
		$parts    = array();
		$sheetxml = array();
		// Worksheets first: they register the styles used by the cells.
		foreach ( $this->sheets as $i => $sheet ) {
			$id                                   = $i + 1;
			$sheetxml[ 'xl/worksheets/sheet' . $id . '.xml' ] = $this->sheet_xml( $sheet );
			$types  .= '<Override PartName="/xl/worksheets/sheet' . $id . '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
			$sheets .= '<sheet name="' . self::esc( $sheet['name'] ) . '" sheetId="' . $id . '" r:id="rId' . $id . '"/>';
			$rels   .= '<Relationship Id="rId' . $id . '" Type="' . self::NS_REL . '/worksheet" Target="worksheets/sheet' . $id . '.xml"/>';
		}
		$parts['[Content_Types].xml'] = self::head() . '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
			. '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
			. '<Default Extension="xml" ContentType="application/xml"/>'
			. '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
			. $types
			. '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
			. '</Types>';
		$parts['_rels/.rels'] = self::head() . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
			. '<Relationship Id="rId1" Type="' . self::NS_REL . '/officeDocument" Target="xl/workbook.xml"/>'
			. '</Relationships>';
		$parts['xl/workbook.xml'] = self::head() . '<workbook xmlns="' . self::NS_MAIN . '" xmlns:r="' . self::NS_REL . '">'
			. '<bookViews><workbookView/></bookViews>'
			. '<sheets>' . $sheets . '</sheets>'
			. '</workbook>';
		$parts['xl/_rels/workbook.xml.rels'] = self::head() . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
			. $rels
			. '<Relationship Id="rId' . ( $n + 1 ) . '" Type="' . self::NS_REL . '/styles" Target="styles.xml"/>'
			. '</Relationships>';
		$parts['xl/styles.xml'] = $this->styles_xml();
		return $parts + $sheetxml;
	}

	/**
	 * Writes the workbook to a temporary file and returns its path (the caller deletes it), or WP_Error.
	 */
	public function save() {
		if ( ! $this->sheets ) {
			return new WP_Error( 'dolly_xlsx', __( 'Nessun foglio da esportare.', 'dolly-employee-management' ), array( 'status' => 400 ) );
		}
		require_once ABSPATH . 'wp-admin/includes/file.php';
		$parts = $this->parts();
		$tmp   = wp_tempnam( 'dolly-foglio.xlsx' );
		if ( class_exists( 'ZipArchive' ) ) {
			$zip = new ZipArchive();
			if ( true !== $zip->open( $tmp, ZipArchive::CREATE | ZipArchive::OVERWRITE ) ) {
				return new WP_Error( 'dolly_xlsx', __( 'Impossibile creare il file Excel.', 'dolly-employee-management' ), array( 'status' => 500 ) );
			}
			foreach ( $parts as $name => $content ) {
				$zip->addFromString( $name, $content );
			}
			if ( ! $zip->close() ) {
				@unlink( $tmp ); // phpcs:ignore
				return new WP_Error( 'dolly_xlsx', __( 'Impossibile creare il file Excel.', 'dolly-employee-management' ), array( 'status' => 500 ) );
			}
			return $tmp;
		}
		// Fallback: the PclZip library bundled with WordPress works from files on disk.
		require_once ABSPATH . 'wp-admin/includes/class-pclzip.php';
		$dir = trailingslashit( get_temp_dir() ) . 'dolly-xlsx-' . wp_generate_password( 8, false, false );
		$files = array();
		foreach ( $parts as $name => $content ) {
			$path = $dir . '/' . $name;
			wp_mkdir_p( dirname( $path ) );
			file_put_contents( $path, $content ); // phpcs:ignore
			$files[] = $path;
		}
		@unlink( $tmp ); // phpcs:ignore
		$zip = new PclZip( $tmp );
		$ok  = $zip->create( $files, PCLZIP_OPT_REMOVE_PATH, $dir );
		foreach ( $files as $f ) {
			@unlink( $f ); // phpcs:ignore
		}
		foreach ( array( '/xl/worksheets', '/xl/_rels', '/xl', '/_rels', '' ) as $sub ) {
			@rmdir( $dir . $sub ); // phpcs:ignore
		}
		if ( 0 === $ok ) {
			return new WP_Error( 'dolly_xlsx', __( 'Impossibile creare il file Excel.', 'dolly-employee-management' ), array( 'status' => 500 ) );
		}
		return $tmp;
	}
}
