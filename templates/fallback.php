<?php
/**
 * Minimal layout used when the active theme does not provide dolly/{view}.php templates.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;
?><!doctype html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
	<meta name="robots" content="noindex, nofollow">
	<meta name="theme-color" content="<?php echo esc_attr( Dolly_Appearance::get( 'header_bg' ) ); ?>">
	<?php wp_head(); ?>
</head>
<body <?php body_class( 'dolly-body dolly-view-' . sanitize_html_class( Dolly_Frontend::current_view() ) ); ?>>
<?php wp_body_open(); ?>
<?php Dolly_Frontend::render_view(); ?>
<?php wp_footer(); ?>
</body>
</html>
