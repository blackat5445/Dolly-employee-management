<?php
/**
 * Minimal layout used when the active theme does not provide dolly/{view}.php templates.
 * Themes can copy it: everything else (content, styles, classes, robots) comes from the plugin.
 *
 * @package DollyEM
 */

defined( 'ABSPATH' ) || exit;
?><!doctype html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
	<meta name="theme-color" content="<?php echo esc_attr( Dolly_Frontend::theme_color() ); ?>">
	<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>
<?php Dolly_Frontend::skip_link(); ?>
<div id="dolly-content"><?php Dolly_Frontend::render_view(); ?></div>
<?php wp_footer(); ?>
</body>
</html>
